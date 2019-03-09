#===============================================================================
# manual switches

DEBUGGING = False
USING_PI = False
USING_BROKER = False
STATIC_ADDRESS = True

#===============================================================================
# imports

# control
from threading import Thread, Lock
from time import time, sleep

# web
from flask import Flask, send_from_directory
from eventlet import wsgi
import eventlet
import socketio

# physical
from heapq import heappush, heappop
try:
	# uart
	from serial import Serial
	# i2c
	from smbus2 import SMBusWrapper
	ONLINE_PHY = True
except ImportError:
	ONLINE_PHY = False
	print('physical side: testing in off-line mode')

#===============================================================================
# global variables

class Reset(Exception):
	pass

if USING_BROKER:
	class I2CError(Exception):
		pass

# control
lock = Lock()
web_thrd = 'to init'
phy_thrd = 'to init'

# web
fnc = {}

# physical
ser_port = '/dev/ttyAMA0' if USING_PI else '/dev/ttyS0'	# serial port name
bus_num = 1	# i2c bus number
i2c_heap = 'to init'
phy = 'to init'
phy_order = 'to init'
phy_flag = 'to init'	# phy updated, need to emit
reset_flag = False

# direction
dx = [-1,0,1,0]
dy = [0,1,0,-1]

# op code
uart_op = {
	'RQ_ADDR'			:0,	# request address
	'RQ_SEND'			:1,	# request sending data
	'SEND_ACK'			:10,# sending acknowledged
	'SEND_DENY'			:11,# sending denied
	'OUT_OF_BOUND'		:12,# address requested is off limit (val<0 or val>255)
	'CONTENT_ADDR'		:13,# instruct the following 2 bytes are address
	'CONTENT_I2C_ADDR'	:14,# I2C address
	'RESET' 			:19,# reset request
}
uart_op_name = {}
for name, code in uart_op.items():
	byte = bytes([code])
	uart_op[name] = byte
	uart_op_name[byte] = name
i2c_op = {
	'I2C_RST'			:20,# I2C message reset
	'I2C_ADDR'			:21,# Distribute I2C address
	'I2C_IMAGE'			:22,# fetch image information
	'I2C_DISP'			:23,# display image(refresh frame - load data)
	'I2C_SHUTDOWN'		:24,# turn off display
	'I2C_TEST'			:25,# 
}

#===============================================================================
# functions

#-------------------------------------------------------------------------------
# web

def server():

	# http server
	app = Flask(__name__)
	@app.route('/')
	def index():
		return send_from_directory('front-end', 'index.html')
	@app.route('/<path:path>')
	def send_root(path):
		return send_from_directory('front-end', path)

	# socket
	sio = socketio.Server()
	app = socketio.Middleware(sio, app)
	@sio.on('connect')
	def connect_cb(sid, environ):
		print('connected:',sid)
		global phy_flag
		phy_flag = True
	@sio.on('disconnect')
	def disconnect_cb(sid):
		print('disconnected:',sid)

	# force phy emitted
	@sio.on('dev')
	def dev_cb(sid, data):
		print('develop data received:',data)
		global phy_flag
		phy_flag = True
	# python-socketio multi-thread problem work-around
	@sio.on('poll_phy')
	def poll_cb(sid):
		lock.acquire()
		global phy_flag
		if phy_flag:
			sio.emit('phy', [phy, phy_order])
			phy_flag = False
			print('phy emitted')
		lock.release()

	# web->physical
	@sio.on('fnc')
	def fnc_cb(sid, data):
		global fnc
		fnc = data
		print('fnc received')
		i2c_scatter_image()
	@sio.on('reset')
	def reset_cb(sid):
		print('reset from client',sid)
		web_reset()

	# file
	file_list = ['test 1', 'test 0']
	file = {
		'test 1':{'126': {'127': {'tp': 'ctrl'}}, '127': {'126': {'tp': 'dbd', 'bmp': [24, 24, 36, 36, 66, 66, 129, 255, 15, 0]}, '127': {'tp': 'dbd', 'bmp': [255, 129, 129, 129, 129, 129, 129, 255, 15, 0]}, '128': {'tp': 'dbd', 'bmp': [255, 129, 66, 66, 36, 36, 24, 24, 15, 0]}}, '128': {'127': {'tp': 'dbd', 'bmp': [60, 66, 129, 129, 129, 129, 66, 60, 15, 0]}}, 'o': {'px': 126, 'py': 128}},
		'test 0':{'126': {'127': {'tp': 'ctrl'}}, '127': {'127': {'tp': 'dbd', 'bmp': [254, 254, 192, 254, 254, 192, 192, 192, 15, 0]}}, '128': {'127': {'tp': 'dbd', 'bmp': [216, 216, 216, 216, 216, 216, 223, 223, 15, 0]}}, '129': {'127': {'tp': 'dbd', 'bmp': [127, 127, 96, 127, 127, 96, 127, 127, 15, 0]}}, 'o': {'px': 126, 'py': 128}},
	}
	@sio.on('flie_list')
	def flie_list_cb(sid):
		print('file_list served')
		return file_list
	@sio.on('file_load')
	def file_load_cb(sid,data):
		print('file "'+data+'" served')
		return file[data]
	@sio.on('file_save')
	def file_save_cb(sid,data):
		file[data['name']] = data['fnc']
		if data['name'] not in file_list:
			file_list.append(data['name'])
		print('file "'+data['name']+'" saved')
	@sio.on('file_del')
	def file_del_cb(sid,data):
		del file[data]
		file_list.remove(data)
		print('file "'+data+'" deleted')
	
	# start wsgi server, following line is blocking
	eventlet.wsgi.server(eventlet.listen(('', 8080)), app, log_output=False)

#-------------------------------------------------------------------------------
# physical

def occupied(dict,x,y):
	if str(x) in dict:
		if str(y) in dict[str(x)]:
			return True
	return False

def byte_to_op_name(bytedata):
	if bytedata == b'':
		return 'timeout'
	return uart_op_name.get(bytedata, hex(bytedata[0]))

# UART non-blocking read
def nb_read(ser,timeout=None):
	if timeout==None:
		non_stop = True
	else:
		non_stop = False
		end_time = time()+timeout
	while non_stop or time()<end_time:
		lock.acquire()
		if ser.in_waiting>0:
			rd = ser.read()
			lock.release()
			return rd
		lock.release()
		if reset_flag:
			raise Reset()
	return b''

# UART wait
# wait for <op_dict> at most <try_max> times, otherwise return False
# try_max==None: try forever
def wait(ser, op_dict, try_max=None, timeout=None):
	print('waiting for',op_dict)
	try_cnt = 0
	hit = False
	while try_max==None or try_cnt<try_max:
		op_rx = byte_to_op_name(nb_read(ser,timeout))
		print('rx',op_rx)
		if op_rx in op_dict:
			hit = True
			break
		else:
			try_cnt += 1
	if hit:
		print('after',try_cnt,'tries')
		return op_rx
	else:
		print('stop waiting for',op_dict,'after',try_cnt,'tries')
		return 'fail'

# UART write
def write(ser, op, *content):
	lock.acquire()
	print('tx',op,content)
	ser.write(uart_op[op])
	ser.write(bytes(content))
	lock.release()

def i2c_write(addr, op, data=[]):
	if USING_BROKER:
		print('i2c',addr,'write',op,data)
		ser_global.write(bytes([addr,i2c_op[op]]+data))
	else:
		lock.acquire()
		print('i2c',addr,'write',op,data)
		try:
			with SMBusWrapper(bus_num) as bus:
				bus.write_i2c_block_data(addr, i2c_op[op], data)
		finally:
			lock.release()

def i2c_image(i_s, j_s):
	addr = phy[i_s][j_s][0]
	if occupied(fnc,int(i_s),int(j_s)):
		bmp = fnc[i_s][j_s]['bmp']
	else:
		bmp = [0,0,0,0,0,0,0,0,0,0]
	try:
		i2c_write(addr, 'I2C_IMAGE', bmp)
	except Exception as ex:
		print(type(ex).__name__+': image scatter failed, ignore')
		print(ex)

def i2c_disp():
	try:
		i2c_write(0, 'I2C_DISP', [])
	except Exception as ex:
		print(type(ex).__name__+': image display failed, ignore')
		print(ex)

def i2c_scatter_image():
	if ONLINE_PHY:
		for i_s in phy:
			for j_s in phy[i_s]:
				i2c_image(i_s,j_s)
		i2c_disp()

def i2c_allocate(x, y, p, ser=None):
	# find parent
	if p>3:
		print('parent direction',p,'out of range, reset')
		reset()
	first = x==127 and y==127
	chd_x,chd_y = str(x),str(y)
	chd_s = '('+chd_x+','+chd_y+')'
	par_x,par_y = str(x+dx[p]),str(y+dy[p])
	par_s = '('+par_x+','+par_y+')'
	if occupied(phy,chd_x,chd_y):
		print(chd_s,'is already occupied but reported by',par_s)
		return
	if not (occupied(phy,par_x,par_y) or first):
		print(chd_s,'has no parent, reset')
		reset()
	# allocate
	chd_addr = 10*(y-121)+(x-114) if STATIC_ADDRESS else heappop(i2c_heap)
	par_addr = -1 if first else phy[par_x][par_y][0]
	chd_dir = (p+2)%4	# direction of new child seen by its parent
	if chd_x not in phy:
		phy[chd_x] = {}
	phy[chd_x][chd_y] = [chd_addr,p]
	phy_order.append([x,y])
	print('phy['+chd_x+']['+chd_y+'] = ['+str(chd_addr)+','+str(p)+']')
	global phy_flag
	phy_flag = True
	# deliver i2c address
	if first:
		while True:
			if reset_flag:
				raise Reset()
			try:
				i2c_write(chd_addr, 'I2C_TEST', [])
				if USING_BROKER:
					response = nb_read(ser_global)[0]
					if response!=30:
						print('broker response:',response)
						raise I2CError()
				break
			except Exception as ex:
				print(type(ex).__name__+': I2C_TEST failed on first module, retry')
				print(ex)
				sleep(0.5)
				write(ser, 'CONTENT_ADDR', 127, 127)
	else:
		while True:
			while True:
				if reset_flag:
					raise Reset()
				try:
					if not STATIC_ADDRESS:
						print('deliver i2c address',chd_addr,
							'through parent'+par_s)
						i2c_write(par_addr,'I2C_ADDR',[chd_dir,chd_addr])
					break
				except Exception as ex:
					print(type(ex).__name__+': delivery failed, retry')
					print(ex)
					sleep(0.5)
			try:
				i2c_write(chd_addr, 'I2C_TEST', [])
				if USING_BROKER:
					response = nb_read(ser_global)[0]
					if response!=30:
						print('broker response:',response)
						raise I2CError()
				break
			except Exception as ex:
				print(type(ex).__name__+': I2C_TEST failed, retry')
				print(ex)
				sleep(0.5)
	# display
	if not DEBUGGING:
		i2c_image(chd_x, chd_y)
		i2c_disp()

def uart_loop():
	with Serial(port=ser_port, baudrate=57600) as ser:
		if USING_BROKER:
			global ser_global
			ser_global = ser
		while True:
			try:
				# first module
				while True:
					op = wait(ser, {'RQ_ADDR','RQ_SEND','RESET'})
					if op!='RQ_ADDR':
						print('invalid op code received on startup, reset')
						reset()
					write(ser, 'CONTENT_ADDR', 127, 127)
					op = wait(ser, {'RQ_SEND','timeout'}, 10, 0.05)
					if op!='fail':
						break
					print('first module UART initialization failed, retry')
				i2c_allocate(127, 127, 0, ser)
				# other modules
				while True:
					op = wait(ser, {'RQ_SEND','CONTENT_ADDR','RESET','RQ_ADDR'})
					if op=='fail':
						print('invalid op code received in loop, discard')
					elif op=='RQ_SEND':
						write(ser, 'SEND_ACK')
					elif op=='CONTENT_ADDR':
						x = nb_read(ser)[0]
						y = nb_read(ser)[0]
						p = nb_read(ser)[0]
						print('rx x:',x,'y:',y,'parent:',p)
						i2c_allocate(x, y, p)
					elif op=='RESET':
						print('reset from physical side')
						reset()
					elif op=='RQ_ADDR':
						print('RQ_ADDR received in loop, reset')
						reset()
					else:
						print('op code "'+op+'" not caught')
			except Reset:
				global reset_flag
				reset_flag = False
				try:
					i2c_write(0, 'I2C_RST', [])
				except Exception as ex:
					print(type(ex).__name__+': I2C_RST failed, ignore')
					print(ex)

def init():
	global i2c_heap
	i2c_heap = []
	for addr in range(8,120):
		heappush(i2c_heap,addr)
	global phy
	phy = {} if ONLINE_PHY else {127:{127:[8,0]}}
	global phy_order
	phy_order = [] if ONLINE_PHY else [[127,127]]
	global phy_flag
	phy_flag = False

def web_reset():
	print('reset')
	init()
	global phy_flag
	phy_flag = True
	global reset_flag
	reset_flag = True

def reset():
	web_reset()
	raise Reset()
			
def run():
	init()
	if ONLINE_PHY:
		global phy_thrd
		phy_thrd = Thread(target=uart_loop)
		phy_thrd.start()
	global web_thrd
	web_thrd = Thread(target=server)
	web_thrd.start()

if __name__ == '__main__':
	run()

'''
to do:
	exceptions on SMBus:
		OSError: [Errno 5] Input/output error
		OSError: [Errno 6] No such device or address
		TimeoutError: [Errno 110] Connection timed out
	move rendering work from front-end to back-end
	put scattering and rendering in another thread
	detect removing first module
	add phy_flag check in event loop
		http://eventlet.net/doc/threading.html#tpool-simple-thread-pool
		http://eventlet.net/doc/modules/greenpool.html
'''