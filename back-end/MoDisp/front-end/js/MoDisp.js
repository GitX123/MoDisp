/*
[abbreviation]
fb stands for function block, a group of matrices.

[coordinates]
lx ,ly stands for local x, y in matrix editor (dot number),
	0 <=	lx, ly	<= 7,
	lx+ is RIGHT,	ly+ is DOWN
ux, uy stands for UI x, y relative to section (matrix number),
	0 <=	ux, uy,
	ux+ is RIGHT,	uy+ is DOWN
px, py stands for physical x, y (matrix number),
	0 <=	px, py	<= 255,
	px+ is RIGHT,	py+ is UP
first module next to controller has (px, py) = (127, 127)

[image]
image[0...7] are 8-bit data encoding each dot of a matrix is lit or not.
image[8,9] is the brightness of green and red respectively.
*/

'use strict';
//==============================================================================
//global constants

const grid_size = 128;	//size of matrix background image
const half_size = grid_size/2;
const dot_size = grid_size/8;
const padding = 4;
const LED_size = dot_size-padding*2;
const blank = '#1e1e1e';//rgb(30,30,30)

//==============================================================================
//global objects

var fnc;		//client->server, function setting, holding all fbs
var phy;		//server->client, physical status
var phy_order;	//server->client, the order modules are detected in
var mode;		//current mode
	/*
	list of all modes:
		none
			click: new Fb_dbd(px,py);
			dblclick: fnc[px][py].edit();
		new_dbd(currently not used)
		new_scr(currently not used)
		file
		move
		delete
		clear
		reset
		test
		demo1
		demo2
	*/
var file_name;	//current file name
var socket;		//socket.io

//==============================================================================
//MODEL(MVC)

//------------------------------------------------------------------------------
//utility

//convert pixel number to matrix number ux, uy
var snap = function(n){
	return Math.floor(n/grid_size);
};

//convert bytes to color string
var color = function(red,green,blue=0){
	return 'rgb('+(30+15*red)+','+(30+15*green)+','+(30+15*blue)+')';
};

//if any fb is found in a rectangular block in fnc then return true
var occupied = function(px, py, w=1, h=1){
	for(var i=px;i<px+w;i++)
		if(fnc[i]!==undefined)
			for(var j=py;j<py+h;j++)
				if(fnc[i][j]!==undefined)
					return true;
	return false;
};

//examine if out of bound of current section
var out_bound = function(px_n,py_n){
	var lt = fnc.o.px;
	var up = fnc.o.py;
	var rt = lt+snap($('section').width());
	var dn = up-snap($('section').height());
	return px_n<lt || px_n>rt || py_n<dn || py_n>up;
};

//------------------------------------------------------------------------------
//classes

class Fb{
	constructor(px,py){
		//append fb to fnc
		if(fnc[px]===undefined) fnc[px] = {};
		fnc[px][py] = this;
		//create canvas and append to DOM
		var cv = $('<canvas>')
			.attr({class:'fg', width:grid_size, height:grid_size})
			.css({left:(px-fnc.o.px)*grid_size, top:-(py-fnc.o.py)*grid_size})
			.appendTo($('section'))
			.draggable().draggable('disable');
		//client only, functions won't be emitted
		this.co = function(){};
		this.co.cv = cv;
		this.co.px = px;
		this.co.py = py;
	}
};

class Fb_ctrl extends Fb{
	constructor(px,py){
		super(px,py);
		this.tp = 'ctrl';
		this.co.cv.css({backgroundImage:'url(image/fg_controller_128.png)'})
			.attr({id:'ctrler'})
			.on('drag', function(e, ui){
				var ux = snap(half_size+ui.position.left);
				var uy = snap(half_size+ui.position.top);
				ui.position.left = ux*grid_size;
				ui.position.top = uy*grid_size;
				var px_n = fnc.o.px+ux;
				var py_n = fnc.o.py-uy;
				if(out_bound(px_n,py_n))
					ui.position = ui.originalPosition;
			})
			.on('dragstop', function(e, ui){
				var round = Math.round;
				var dux = round((ui.position.left-ui.originalPosition.left)
					/grid_size);
				var duy = round((ui.position.top-ui.originalPosition.top)
					/grid_size);
				fnc.o.px -= dux;
				fnc.o.py += duy;
				$('.fg,.bg').not('#ctrler').offset(
					function(idx,coords){return {
						left:coords.left+dux*grid_size,
						top:coords.top+duy*grid_size}});
			});
	}
	edit(){}
	del(){}
};

class Fb_dbd extends Fb{
	constructor(px,py){
		super(px,py);
		this.tp = 'dbd';
		this.bmp = [0,0,0,0,0,0,0,0,15,0];
		this.co.cv.css({backgroundImage:'url(image/fg_dbd_128.png)'})
			.on('drag', function(e, ui){
				var ux = snap(half_size+ui.position.left);
				var uy = snap(half_size+ui.position.top);
				ui.position.left = ux*grid_size;
				ui.position.top = uy*grid_size;
				var px_n = fnc.o.px+ux;
				var py_n = fnc.o.py-uy;
				if(occupied(px_n,py_n) || out_bound(px_n,py_n))
					ui.position = ui.originalPosition;
			})
			.on('dragstop', function(e, ui){
				var round = Math.round;
				var px_o = fnc.o.px+round(ui.originalPosition.left/grid_size);
				var py_o = fnc.o.py-round(ui.originalPosition.top/grid_size);
				var px_n = fnc.o.px+round(ui.position.left/grid_size);
				var py_n = fnc.o.py-round(ui.position.top/grid_size);
				if(px_n===px_o && py_n===py_o) return;
				if(fnc[px_n]===undefined) fnc[px_n] = {};
				fnc[px_n][py_n] = fnc[px_o][py_o];
				fnc[px_o][py_o] = undefined;
				socket.emit('fnc', fnc);
			});
		this.co.ctx = this.co.cv[0].getContext('2d');
	}
	get color(){
		return color(this.bmp[9],this.bmp[8]);
	}
	edit(){
		Fb_dbd.editor.pressed = false;
		Fb_dbd.editor.fb = this;
		Fb_dbd.editor.render();
	}
	del(){
		this.co.cv.remove();
		fnc[this.co.px][this.co.py] = undefined;
		socket.emit('fnc', fnc);
	}
	render(){
		var ctx = this.co.ctx;
		ctx.fillStyle = this.color;
		for(var j=0;j<8;j++){
			var tmp = this.bmp[j];
			for(var i=0;i<8;i++){
				if(tmp&128)
					ctx.fillRect(padding+i*dot_size, padding+j*dot_size,
						LED_size, LED_size);
				else
					ctx.clearRect(padding+i*dot_size, padding+j*dot_size,
						LED_size, LED_size);
				tmp <<= 1;
			}
		}
	}
	clear(){
		this.co.ctx.clearRect(0, 0, grid_size, grid_size);
	}
};
Fb_dbd.editor = {render:function(){
	var color = Fb_dbd.editor.fb.color;
	var bmp = Fb_dbd.editor.fb.bmp;
	for(var j=0;j<8;j++){
		var byte_tmp = bmp[j];
		for(var i=0;i<8;i++){
			if(byte_tmp&128)
				$('div[lx="'+i+'"][ly="'+j+'"]')
					.css({background:color})
					.attr({state:'on'});
			else
				$('div[lx="'+i+'"][ly="'+j+'"]')
					.css({background:blank})
					.attr({state:'off'});
			byte_tmp <<= 1;
		}
	}
	$('#dbd_editor_indicator')[0].style.background = color;
	$('#dbd_editor_slider_r')[0].value = bmp[9];
	$('#dbd_editor_slider_g')[0].value = bmp[8];
	$('#dbd_editor_bg')[0].style.display = 'block';
}};

//------------------------------------------------------------------------------
//operations

var test = function(){
	{
		//initialize test mode and color red
		listeners_off();
		$('.fg').not('#ctrler').hide();
		test.fnc = {};
		test.fb = {tp:'dbd', bmp:[255,255,255,255,255,255,255,255,0,15]};
		for(var i in phy){
			i = parseInt(i);
			test.fnc[i] = {};
			for(var j in phy[i]){
				j = parseInt(j);
				test.fnc[i][j] = test.fb;
				$('section').append($('<img>')
					.attr({class:'bg_tmp', src:'image/bg_test_red_128.png'})
					.css({left:(i-fnc.o.px)*grid_size,
						top:-(j-fnc.o.py)*grid_size}));
			}
		}
		socket.emit('fnc', test.fnc);
	}
	setTimeout(function(){
		//color green
		test.fb.bmp = [255,255,255,255,255,255,255,255,15,0];
		$('.bg_tmp').attr({src:'image/bg_test_green_128.png'});
		socket.emit('fnc', test.fnc);
	}, 600);
	setTimeout(function(){
		//restore
		socket.emit('fnc', fnc);
		set_mode('none');
		$('.bg_tmp').remove();
		$('.fg').show();
		listeners_on();
	}, 1200);
};

////////////////////////////////////////////////////////////////////////////////
//A BIG MESS, NEED TIDYING UP
const DI = [{px:-1,py:0},{px:0,py:1},{px:1,py:0},{px:0,py:-1}];
var OR = function(bmp1,bmp2){
	var bmp = [0,0,0,0,0,0,0,0,15,15];
	for (var j=0;j<8;j++){
		bmp[j] = bmp1[j]|bmp2[j];
	}
	return bmp;
};
////////////////////////////////////////////////////////////////////////////////
const bmp_dir = [
	[[0,0,128,128,128,128,0,0,15,15],[0,0,0,192,192,0,0,0,15,15]],
	[[60,0,0,0,0,0,0,0,15,15],[24,24,0,0,0,0,0,0,15,15]],
	[[0,0,1,1,1,1,0,0,15,15],[0,0,0,3,3,0,0,0,15,15]],
	[[0,0,0,0,0,0,0,60,15,15],[0,0,0,0,0,0,24,24,15,15]]
];
const bmp_empty = [129,0,0,0,0,0,0,129,15,15];
const bmp_finish = [129,0,60,60,60,60,0,129,15,15];
var demo1;
var demo1_render = function(){
	if(demo1.cnt===0){
		if(demo1.index===demo1.length){
			for(var i in demo1.phy)
				for(var j in demo1.phy[i])
					fnc[i][j].co.shouting = true;
			demo1.index = 0;
		}
	}
	else{
		var coords = demo1.phy_order[demo1.index]
		demo1.index++;
		var px = coords[0];
		var py = coords[1];
		var par_d = demo1.phy[px][py][1];
		var par = fnc[px+DI[par_d].px][py+DI[par_d].py];
		par.bmp = OR(par.bmp,bmp_dir[(par_d+2)%4][1]);
		par.render();
		var chd = fnc[px][py];
		chd.co.shouting = false;
		chd.bmp = OR(bmp_finish,bmp_dir[par_d][1]);
		chd.render();
	}
	for(var i in demo1.phy){
		i = parseInt(i);
		for(var j in demo1.phy[i]){
			j = parseInt(j);
			var fb = fnc[i][j];
			if(fb.co.shouting){
				if(demo1.cnt===0){
					var bmp_tmp = bmp_empty;
					for(var d=0;d<4;d++){
						var nbr_px = i+DI[d].px;
						var nbr_py = j+DI[d].py;
						if(occupied(nbr_px,nbr_py)
							&& fnc[nbr_px][nbr_py].tp==='dbd')
							bmp_tmp = OR(bmp_tmp,bmp_dir[d][0]);
					}
					fb.bmp = bmp_tmp;
				}
				else{
					fb.bmp = bmp_empty;
				}
				fb.render();
			}
		}
	}
	socket.emit('fnc',fnc);
	demo1.cnt = (demo1.cnt+1)%2;
};
var demo1_enter = function(){
	if(phy_order.length===0){
		set_mode('none');
		return;
	}
	demo1 = {};
	demo1.fnc_backup = JSON.stringify(fnc);
	//#if DEMO1_TEST
	// demo1.phy = {
		// 126:{126:[14,2]},
		// 127:{125:[13,1],126:[10,1],127:[8,0]},
		// 128:{125:[16,1],126:[12,1],127:[9,0]},
		// 129:{125:[17,1],126:[15,1],127:[11,0]}
	// };
	// demo1.phy_order = [[127,127],[128,127],[127,126],[129,127],[128,126],
		// [127,125],[126,126],[129,126],[128,125],[129,125]];
	// socket_on_phy([demo1.phy,demo1.phy_order]);
	//#else
	demo1.phy = phy;
	demo1.phy_order = phy_order;
	//#endif
	$('.fg').remove();
	fnc = {o:fnc.o};
	var ctrl = new Fb_ctrl(126,127);
	ctrl.co.shouting = false;
	ctrl.bmp = bmp_empty;
	ctrl.render = function(){};
	for(var i in demo1.phy){
		i = parseInt(i);
		for(var j in demo1.phy[i]){
			j = parseInt(j);
			var dbd = new Fb_dbd(i,j);
			dbd.co.shouting = true;
		}
	}
	demo1.index = 0;
	demo1.length = demo1.phy_order.length;
	demo1.cnt = 0;
	demo1.pause = true;
	demo1_pause_play();
	$('#demo1_bg')[0].style.display= 'block';
};
var demo1_pause_play = function(){
	if(demo1.pause){
		demo1_render();
		demo1.timer = setInterval(demo1_render, 250);
	}
	else
		clearInterval(demo1.timer);
	demo1.pause = !demo1.pause;
};
var demo1_exit = function(bg){
	clearInterval(demo1.timer);
	load(JSON.parse(demo1.fnc_backup));
	bg.style.display = 'none';
	set_mode('none');
};
////////////////////////////////////////////////////////////////////////////////
var demo2;
var shift = [
	function(bmp_s,bmp_d){
		for(var j=0;j<8;j++){
			bmp_d[j] <<= 1;
			bmp_d[j] |= (bmp_s[j]&128)>>7;
			bmp_s[j] <<= 1;
			bmp_s[j] &= 255;
		}
	},
	function(bmp_s,bmp_d){
		for(var j=0;j<7;j++)
			bmp_d[j] = bmp_d[j+1];
		bmp_d[7] = bmp_s[0];
		for(var j=0;j<7;j++)
			bmp_s[j] = bmp_s[j+1];
		bmp_s[7] = 0;
	},
	function(bmp_s,bmp_d){
		for(var j=0;j<8;j++){
			bmp_d[j] >>= 1;
			bmp_d[j] |= (bmp_s[j]&1)<<7;
			bmp_s[j] >>= 1;
		}
	},
	function(bmp_s,bmp_d){
		for(var j=7;j>0;j--)
			bmp_d[j] = bmp_d[j-1];
		bmp_d[0] = bmp_s[7];
		for(var j=7;j>0;j--)
			bmp_s[j] = bmp_s[j-1];
		bmp_s[0] = 0;
	}
];
var is_par = function(sus,chd){
	var chd_px = chd[0];
	var chd_py = chd[1];
	if(demo2.phy[chd_px]===undefined) return false;
	if(demo2.phy[chd_px][chd_py]===undefined) return false;
	var par_dir = demo2.phy[chd_px][chd_py][1];
	return chd_px+DI[par_dir].px===sus[0] && chd_py+DI[par_dir].py===sus[1];
}
var demo2_render = function(){
	var src_fb = fnc[demo2.src[0]][demo2.src[1]];
	var dst_fb = fnc[demo2.dst[0]][demo2.dst[1]];
	shift[demo2.dir](src_fb.bmp,dst_fb.bmp);
	src_fb.render();
	dst_fb.render();
	socket.emit('fnc',fnc);
	demo2.cnt++;
	if(demo2.cnt===8){
		demo2.cnt = 0;
		if(demo2.dst[0]===126&&demo2.dst[1]===127){
			demo2.dir = 2;
			demo2.src = [126,127];
			demo2.dst = [127,127];
		}
		else{
			var dir = (demo2.dir+2)%4
			var src = demo2.dst;
			var dst;
			do{
				dir = (dir+1)%4;
				dst = [src[0]+DI[dir].px,src[1]+DI[dir].py];
			}while(!(is_par(src,dst) || is_par(dst,src)))
			demo2.dir = dir;
			demo2.src = src;
			demo2.dst = dst;
		}
	}
};
var demo2_enter = function(){
	if(phy_order.length===0){
		set_mode('none');
		return;
	}
	demo2 = {};
	demo2.fnc_backup = JSON.stringify(fnc);
	//#if demo2_TEST
	// demo2.phy = {
		// 126:{126:[14,2]},
		// 127:{125:[13,1],126:[10,1],127:[8,0]},
		// 128:{125:[16,1],126:[12,1],127:[9,0]},
		// 129:{125:[17,1],126:[15,1],127:[11,0]}
	// };
	// socket_on_phy([demo2.phy,phy_order]);
	//#else
	demo2.phy = phy;
	//#endif
	$('.fg').remove();
	fnc = {o:fnc.o};
	var ctrl = new Fb_ctrl(126,127);
	ctrl.bmp = [231,195,189,60,60,189,195,231,15,15];
	ctrl.render = function(){};
	for(var i in demo2.phy){
		i = parseInt(i);
		for(var j in demo2.phy[i]){
			j = parseInt(j);
			var dbd = new Fb_dbd(i,j);
			dbd.bmp = [0,0,0,0,0,0,0,0,15,15];
		}
	}
	demo2.dir = 2;
	demo2.src = [126,127];
	demo2.dst = [127,127];
	demo2.cnt = 0;
	demo2.timer = setInterval(demo2_render, 50);
	$('#demo2_bg')[0].style.display= 'block';
};
var demo2_exit = function(){
	clearInterval(demo2.timer);
	load(JSON.parse(demo2.fnc_backup));
	this.style.display = 'none';
	set_mode('none');
};
////////////////////////////////////////////////////////////////////////////////

//==============================================================================
//VIEW(MVC)

//------------------------------------------------------------------------------
//physical side

//update physical status
var socket_on_phy = function(data){
	phy = data[0];
	phy_order = data[1];
	$('.bg').remove();
	for(var i in phy){
		i = parseInt(i);
		for(var j in phy[i]){
			j = parseInt(j);
			$('section').append($('<img>')
				.attr({class:'bg', src:'image/bg_module_128.png'})
				.css({left:(i-fnc.o.px)*grid_size,
					top:-(j-fnc.o.py)*grid_size}));
		}
	}
}

//------------------------------------------------------------------------------
//dbd_editor

var dbd_editor_toggle_dot = function(dot){
	var lx = parseInt(dot.getAttribute('lx'));
	var ly = parseInt(dot.getAttribute('ly'));
	var lit = dot.getAttribute('state')==='on'?false:true;
	var fb = Fb_dbd.editor.fb;
	dot.style.background = lit?fb.color:blank;
	//write bmp
	if(lit)
		fb.bmp[ly] |= 128>>lx;
	else
		fb.bmp[ly] &= ~(128>>lx);
	//update state
	dot.setAttribute('state', lit?'on':'off');
};

var dbd_editor_update_color = function(){
	if(this.id==='dbd_editor_slider_r')
		Fb_dbd.editor.fb.bmp[9] = parseInt(this.value);
	if(this.id==='dbd_editor_slider_g')
		Fb_dbd.editor.fb.bmp[8] = parseInt(this.value);
	Fb_dbd.editor.render();
};

var dbd_editor_exit = function(bg){
	Fb_dbd.editor.fb.render();
	bg.style.display = 'none';
	socket.emit('fnc',fnc);
};

//------------------------------------------------------------------------------
//file

var file_list;

//enter file mode
var file_enter = function(){
	socket.emit('flie_list',function(data){
		file_list = data;
		for(var name of file_list)
			$('#file_save').after(
				$('<button>').attr({class:'file_button'}).html(name)
				.on('mouseup', file_onclick)
				.on('contextmenu',function(e){e.preventDefault();})
			)
		$('#file_bg')[0].style.display= 'block';
	});
}

//save file
var file_save_onclick = function(){
	var name = prompt('File name: ', file_name);
	while(name==='') name = prompt('File name can\'t be empty: ', file_name);
	if(name===null) return;
	if(file_list.indexOf(name)===-1){
		$(this).after(
			$('<button>').attr({class:'file_button'}).html(name)
			.on('mouseup', file_onclick)
			.on('contextmenu',function(e){e.preventDefault();})
		)
		file_list.push(name);
	}
	else{
		if(!confirm('Overwrite file "'+name+'" ?')) return;
	}
	file_name = name;
	socket.emit('file_save',{name:name,fnc:fnc});
};

//load file implementation
var load = function(data){
	socket.emit('fnc', data);
	var dux = -(data.o.px - fnc.o.px);
	var duy = data.o.py - fnc.o.py;
	$('.bg').offset(
		function(idx,coords){return {
			left:coords.left+dux*grid_size,
			top:coords.top+duy*grid_size}});
	$('.fg').remove();
	fnc = {o:data.o};
	for(var i in data){
		i = parseInt(i);
		for(var j in data[i]){
			j = parseInt(j);
			switch(data[i][j].tp){
			case 'ctrl':
				new Fb_ctrl(i,j);
				break;
			case 'dbd':
				var dbd = new Fb_dbd(i,j);
				dbd.bmp = data[i][j].bmp;
				dbd.render();
				break;
			default:
				console.error('unknown fb type:',data[i][j].tp);
			}
		}
	}
};

//load file or delete file
var file_onclick = function(e){
	var name = this.innerHTML;
	//load file
	if(e.button===0){
		if(!confirm('Load file "'+name+'" ?\n\
			Current setting will be overwritten.')) return;
		socket.emit('file_load',name,load);
		file_name = name;
	}
	//delete file
	else if(e.button===2){
		if(!confirm('Delete file "'+name+'" ?')) return;
		socket.emit('file_del',name);
		this.remove();
	}
};

//exit from file mode
var file_exit = function(bg){
	bg.style.display = 'none';
	$('.file_button').remove();
	file_list = [];
	set_mode('none');
};

//------------------------------------------------------------------------------
//nav

var set_mode = function(mode_new){
	if(mode_new===mode) return;
	$('[mode_name="'+mode+'"] img').css({background:''});
	mode = mode_new;
	$('[mode_name="'+mode+'"] img').css({background:'#000'});
};

var nav_li_onclick = function(){
	var mode_old = mode;
	var mode_temp = this.getAttribute('mode_name');
	//update mode
	if(mode_temp===mode)
		set_mode('none');
	else
		set_mode(mode_temp);
	//handle exiting of old mode
	if(mode_old==='move')
		$('.fg').draggable('disable');
	//handle entering of new mode
	switch(mode){
	case 'none':
		break;
	case 'file':
		file_enter();
		break;
	case 'move':
		$('.fg').draggable('enable');
		break;
	case 'delete':
		break;
	case 'clear':
		$('.fg').remove();
		fnc = {o:fnc.o};
		new Fb_ctrl(126,127);
		socket.emit('fnc', fnc);
		set_mode('none');
		break;
	case 'reset':
		socket.emit('reset');
		set_mode('none');
		break;
	case 'test':
		test();
		break;
	case 'demo1':
		demo1_enter();
		break;
	case 'demo2':
		demo2_enter();
		break;
	default:
		console.error('mode "'+mode+'" not caught');
	}
};

var nav_li_ondblclick = function(e){};

//------------------------------------------------------------------------------
//section

var section_onclick = function(e){
	//convert pixel number to matrix number
	var px = fnc.o.px+snap(e.clientX-this.offsetLeft);
	var py = fnc.o.py-snap(e.clientY-this.offsetTop);
	//handle event
	switch(mode){
	case 'none':
		if(!occupied(px,py))
			new Fb_dbd(px,py);
		break;
	case 'move':
		break;
	case 'delete':
		if(occupied(px,py))
			fnc[px][py].del();
		break;
	default:
		console.error('mode "'+mode+'" not caught');
	}
};

var section_ondblclick = function(e){
	//convert pixel number to matrix number
	var px = fnc.o.px+snap(e.clientX-this.offsetLeft);
	var py = fnc.o.py-snap(e.clientY-this.offsetTop);
	//handle event
	switch(mode){
	case 'none':
		if(occupied(px,py))
			fnc[px][py].edit();
		break;
	case 'move':
		break;
	case 'delete':
		break;
	default:
		console.error('mode "'+mode+'" not caught');
	}
};

//------------------------------------------------------------------------------
//main

var listeners_on = function(){
	$('nav li')
		.on('click', nav_li_onclick)
		.on('dblclick', nav_li_ondblclick);
	$('section')
		.on('click', section_onclick)
		.on('dblclick', section_ondblclick);
};

var listeners_off = function(){
	$('nav li')
		.off('click', nav_li_onclick)
		.off('dblclick', nav_li_ondblclick);
	$('section')
		.off('click', section_onclick)
		.off('dblclick', section_ondblclick);
};

//==============================================================================
//CONTROLLER(MVC)

var poll_timer;
window.onload = function(){
	//generate dbd_editor_matrix divs
	var mat = $('#dbd_editor_matrix')
	for(var j=0;j<8;j++){
		for(var i=0;i<8;i++)
			mat.append($('<div>')
				.attr({class:'matrix_dot', lx:i, ly:j, state:'off'}));
		mat.append('<br>');
	}
	//initialize global variables
	fnc = {o:{px:126, py:128}};
	new Fb_ctrl(126,127);
	phy = {};
	phy_order = [];
	mode = 'none';
	file_name = 'new file';
	socket = io();
	socket.on('connect', function(){
		$('#conn_stat').html('connected'); socket.emit('fnc',fnc);});
	socket.on('disconnect', function(){
		$('#conn_stat').html('disconnected');});
	socket.on('phy', socket_on_phy);
	//listeners
	listeners_on();
	var bg = $('#dbd_editor_bg');
	bg.on('mousedown', function(){Fb_dbd.editor.pressed = true;});
	bg.on('mouseup', function(){Fb_dbd.editor.pressed = false;});
	bg.on('mousedown mouseover', function(e){
		if(!Fb_dbd.editor.pressed) return;
		if(e.target.className!=='matrix_dot') return;
		dbd_editor_toggle_dot(e.target);
	});
	bg.on('click', function(e){
		if(e.target!==this) return;
		dbd_editor_exit(this);
	});
	$('input[type="range"]').on('change', dbd_editor_update_color);
	$('#file_bg').on('click', function(e){
		if(e.target!==this) return;
		file_exit(this);
	});
	$('#file_save').on('click', file_save_onclick);
	$('#demo1_bg').on('mouseup', function(e){
		if(e.button===0) demo1_exit(this);
		else if(e.button===2) demo1_pause_play();
	}).on('contextmenu',function(e){e.preventDefault();});
	$('#demo2_bg').on('click', demo2_exit);
	//python-socketio multi-thread problem work-around
	poll_timer = setInterval(function(){socket.emit('poll_phy');}, 100);
};

//==============================================================================
/*to do
allow phy change in demo modes
callbacks don't get generated more than once
merge draggable callbacks
var->let if possible
jQuery optimization: jQuery(selector, context)
*/