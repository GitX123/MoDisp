/* select "Tools->ATmega328 on breadboard 8MHz" to use internal clock */
#include <stdint.h>
#include <avr/interrupt.h>
#include <avr/wdt.h>
#include <util/delay.h>
#include "operation.h"

/* max7221 select pins */
#define G_SS 8
#define R_SS 9

/* --- temp --- */
uint8_t test_img[8] = {0xff, 0, 0xff, 0, 0xff, 0, 0xff, 0};
/* --- Global Variables --- */
uint8_t op;
bool hasAddress = false;
uint16_t myAddress; // address of this module s{row(x),column(y)}
uint8_t parent_position;
uint8_t PORT_DIR[4]; // PORT:index , content: direction
bool isConnect[4] = {false}; // connection status
/* --- I2C --- */
volatile uint8_t dir, i2c_addr = 0, i2c_addr_last = 0; // current i2c data
/* --- Ports --- */
/* All serial ports are inverse logic(internal pull up)*/
const uint8_t rx[4] = {14, 16, 4, 6};
const uint8_t tx[4] = {15, 17, 5, 7};
SoftwareSerial UART0(rx[0], tx[0], true);
SoftwareSerial UART1(rx[1], tx[1], true);
SoftwareSerial UART2(rx[2], tx[2], true);
SoftwareSerial UART3(rx[3], tx[3], true);
/* --- Image --- */
volatile uint8_t image[8];
volatile uint8_t intensity_G, intensity_R;
/* --- Timer --- */
volatile bool dispEnable = false;
volatile bool loadEnable = false;

void timer_setup() {
  TCNT1 = 64286; // 10ms at 8MHz
  TCCR1A = 0x00;
  TCCR1B = (1 << CS11) | (1 << CS10); // 64 prescaler
}

ISR(TIMER1_OVF_vect) {
  static bool colorToggle = true;
  if (loadEnable) {
    transform(image);
    disp(G_SS, intensity_G, image);
    disp(R_SS, intensity_R, image);
    loadEnable = false;
  }
  if (dispEnable) {
    if (colorToggle) {
      // shutdown red, enable green
      max7221(R_SS, SHUTDOWN, 0x00);
      max7221(G_SS, SHUTDOWN, 0x01);
    }
    else {
      // shutdown green, enable red
      max7221(G_SS, SHUTDOWN, 0x00);
      max7221(R_SS, SHUTDOWN, 0x01);
    }
    colorToggle = !colorToggle;
  }
  else {
    // turn off display
    max7221(G_SS, SHUTDOWN, 0x00);
    max7221(R_SS, SHUTDOWN, 0x00);
  }
  TCNT1 = 64286;
}

void setup() {
  //  MCUSR = 0;
  //  WDTCSR = 0;
  MCUSR = 0; // clear WDT reset flag
  wdt_disable(); // disable WDT reset
  
  SPI.begin();
  Serial.begin(9600);

// not sure why this will fail
//  Wire.begin(127); // fake i2c slave for reset function
//  TWAR |= (1 << TWGCE);
//  Wire.onReceive(fakeReceiveEvent);
  
  module_setup();
  timer_setup();

  Serial.println("reset");
  requestAddress();
  if (myAddress != plane_center)
    wait_i2cAddr();
}

void loop() {
  /* polling 4 serial ports
    probably change to interrupt-driven*/
  for (uint8_t i = 0; i < 4; i++) {
    bool connection = !(digitalRead( rx[PORT[i]] ));
    if (connection) { // connected
      listenPort(PORT[i]);
      _delay_ms(10);
      if (availablePort(PORT[i])) {
        op = readPort(PORT[i]);
        action(i, op);
      }
    }
    else {
      // connection status changed
      if (connection != isConnect[i]) {
        // check connection again
        // if disconnected: note controller to reset all modules: reset_i2c = true
        _delay_ms(200); // time for manually reset
        connection = connect_check(PORT[i]);
      }
    }
    isConnect[i] = connection; // refresh connection status
  }
}

void fakeReceiveEvent(int bytes) {
  if (Wire.available()) {
    cli();
    WDTCSR |= (1 << WDE);
    sei();
    while (1);
  }
}

void receiveEvent(int bytes) {
  if (Wire.available()) {
    uint8_t i2c_op = Wire.read();

    switch (i2c_op) {
      // perform actions according to op
      case (I2C_RST):
        cli();
        WDTCSR |= (1 << WDE); // enable WDT reset
        sei();
        //        wdt_enable(WDTO_15MS);
        while (1); // lock until reset
        break;
      case (I2C_ADDR):
        if (Wire.available() >= 2) {
          dir = Wire.read();
          i2c_addr = Wire.read();
        }
        //        sendI2CAddr(dir, i2c_addr); this function in I2C cause trouble, put this into normal flow
        break;
      case (I2C_IMAGE):
        if (Wire.available() >= 10) {
          for (uint8_t i = 0; i < 8; i++)
            image[i] = Wire.read();
          intensity_G = Wire.read();
          intensity_R = Wire.read();
        }
        break;
      case (I2C_DISP): // refresh image-related data
        dispEnable = true;
        loadEnable = true;
        TIMSK1 = (1 << TOIE1); // enable timer
        sei();
        break;
      case (I2C_SHUTDOWN):
        dispEnable = false;
        TIMSK1 &= ~(1 << TOIE1); // disable timer
        break;
      case (I2C_TEST):
        break;
      default: break;
    }
  }
}
