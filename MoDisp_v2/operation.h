#ifndef __operation_H_
#define __operation_H_
#define VERSION 1

#include <SoftwareSerial.h>
#include <SPI.h>
#include <Wire.h>
#include <stdint.h>
#include "op.h"

/* --- temp --- */
extern uint8_t test_img[8];

/* -------------------- MAX7221 -------------------- */
/* MAX7221 select pins */
#define G_SS 8
#define R_SS 9

/* MAX7221 Register Map */
#define NOOP        0x00 // no operation, for cascade
// DIGIT[8] = {0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08};
#define DECODEMODE  0x09  //default: 0x00 (no decode)
#define INTENSITY   0x0A  //default: 0x00 (darkest)
#define SCANLIMIT   0x0B  //default: 0x00 (1 digit or 1 column)
#define SHUTDOWN    0x0C  //default: 0x00 (shutdown)
#define DISPLAYTEST 0x0F  //default: 0x01 (display test)

/* MAX7221 operations */
void max7221(uint8_t CS,uint8_t reg,uint8_t val);
void max7221_setup(uint8_t CS);

/* -------------------- Address -------------------- */
extern bool hasAddress;
extern uint16_t myAddress;
const uint16_t plane_center = (127<<8) + 127;
extern uint8_t parent_position;


/* -------------------- Ports -------------------- */
extern const uint8_t rx[4];
extern const uint8_t tx[4];
extern SoftwareSerial UART0;
extern SoftwareSerial UART1;
extern SoftwareSerial UART2;
extern SoftwareSerial UART3;

/* Port number & direction */
const uint8_t LEFT = 0;
const uint8_t UP = 1;
const uint8_t RIGHT = 2;
const uint8_t DOWN = 3;
const uint8_t PORT[4] = {0, 1, 2, 3};
extern uint8_t PORT_DIR[4]; 

/* Port Operations */
void listenPort(uint8_t port);
uint8_t readPort(uint8_t port);
int availablePort(uint8_t port);
void writePort(uint8_t port, uint8_t content);

void set_port_dir(uint8_t port, uint8_t parent_position);
uint8_t dir_to_port(uint8_t dir); // map direction to corresponding portn number

void reset(); // send reset signals
bool connect_check(uint8_t port); // check connection

/* -------------------- Setup -------------------- */
void serialSetup(long baud);
void module_setup();

/* -------------------- Main Functions -------------------- */
void requestAddress(); // request address from parent module
void wait_i2cAddr(); // wait for i2c address
void sendAddress(uint8_t x, uint8_t y); // send address to parent module
void transform(uint8_t img[8]); // transform image to the right direction
void disp(uint8_t color, uint8_t intensity, uint8_t img[8]); // display image
void action(uint8_t port, uint8_t op); // perform action according to flag received
/* -------------------- I2C -------------------- */
void sendI2CAddr(uint8_t dir,uint8_t i2c_addr);
extern void receiveEvent(int bytes);
extern volatile uint8_t dir, i2c_addr, i2c_addr_last;
#endif
