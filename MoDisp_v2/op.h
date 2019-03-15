/* Port */
#define RQ_ADDR 0 // request address
#define RQ_SEND 1 // request sending data

#define SEND_ACK 10 // sending acknowledged
#define SEND_DENY 11 // sending denied
#define OUT_OF_BOUND 12 // address requested is off limit (value<0 || value>255)
#define CONTENT_ADDR 13 // instruct the following 2 bytes are address
#define CONTENT_I2C_ADDR 14 // I2C address
#define CONNECT_CHK 15 // connection check
#define CONNECT_Y 16// response to connection check(yes)
#define RESET 19 // reset signal

/* I2C */
#define I2C_RST 20 // I2C message reset
#define I2C_ADDR 21 // Distribute I2C address
#define I2C_IMAGE 22 // fetch image information
#define I2C_DISP 23 // display image(refresh frame - load data)
#define I2C_SHUTDOWN 24 // turn off display
#define I2C_TEST 25 // test connection
