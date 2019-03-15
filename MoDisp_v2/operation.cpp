#include "operation.h"

void max7221(uint8_t color, uint8_t reg, uint8_t val) {
  digitalWrite(R_SS, LOW);
  digitalWrite(G_SS, LOW);
#if VERSION == 1
  switch (color) {
    case G_SS:
      SPI.transfer(NOOP);
      SPI.transfer(NOOP);
      SPI.transfer(reg);
      SPI.transfer(val);
      break;
    case R_SS:
      SPI.transfer(reg);
      SPI.transfer(val);
      SPI.transfer(NOOP);
      SPI.transfer(NOOP);
      break;
    default: break;
  }
#elif VERSION == 2
  switch (color) {
    case G_SS:
      SPI.transfer(reg);
      SPI.transfer(val);
      SPI.transfer(NOOP);
      SPI.transfer(NOOP);
      break;
    case R_SS:
      SPI.transfer(NOOP);
      SPI.transfer(NOOP);
      SPI.transfer(reg);
      SPI.transfer(val);
      break;
    default: break;
  }
#endif
  digitalWrite(R_SS, HIGH);
  digitalWrite(G_SS, HIGH);
}

void max7221_setup(uint8_t CS) {
  pinMode(CS, OUTPUT);
  for (int i = 0; i < 16; i++)
    max7221(CS, i, 0x00); // clear all registers
  max7221(CS, SHUTDOWN, 0x01); // close shutdown mode
  max7221(CS, DISPLAYTEST, 0x00); // normal operation
  max7221(CS, SCANLIMIT, 0x07); // scan all
}

void serialSetup(long baud) {
  for (int i = 0; i < 4; i++)
    digitalWrite(rx[i], HIGH); //pull-up rx
  UART0.begin(baud);
  UART1.begin(baud);
  UART2.begin(baud);
  UART3.begin(baud);
}

void module_setup() {
  max7221_setup(G_SS);
  max7221_setup(R_SS);
  /* All seral ports operate at 57600kbps */
  serialSetup(57600);
}

void disp(uint8_t color, uint8_t intensity, uint8_t img[8]) {
  // shutdown all
  max7221(G_SS, SHUTDOWN, 0x00);
  max7221(R_SS, SHUTDOWN, 0x00);

  if (intensity > 0) {
    // load data
    max7221(color, INTENSITY, intensity - 1 );
    for (uint8_t i = 0; i < 8; i++) {
      max7221(color, i + 1, img[i]);
    }
    // activate
    max7221(color, SHUTDOWN, 0x01);
  }
  else {
    for (uint8_t i = 0; i < 8; i++) {
      max7221(color, i + 1, 0); // clear register
    }
  }
  max7221(color, SCANLIMIT, 0x07); // ensure scan all
}

void listenPort(uint8_t port) {
  switch (port) {
    case 0:
      UART0.listen();
      break;
    case 1:
      UART1.listen();
      break;
    case 2:
      UART2.listen();
      break;
    case 3:
      UART3.listen();
      break;
    default: break;
  }
}

int availablePort(uint8_t port) {
  int avail;
  switch (port) {
    case 0:
      avail = UART0.available();
      break;
    case 1:
      avail = UART1.available();
      break;
    case 2:
      avail = UART2.available();
      break;
    case 3:
      avail = UART3.available();
      break;
    default: break;
  }
  return avail;
}

uint8_t readPort(uint8_t port) {
  uint8_t content;
  switch (port) {
    case 0:
      content = uint8_t(UART0.read());
      break;
    case 1:
      content = uint8_t(UART1.read());
      break;
    case 2:
      content = uint8_t(UART2.read());
      break;
    case 3:
      content = uint8_t(UART3.read());
      break;
    default: break;
  }
  return content;
}

void writePort(uint8_t port, uint8_t content) {
  switch (port) {
    case 0:
      UART0.write(content);
      break;
    case 1:
      UART1.write(content);
      break;
    case 2:
      UART2.write(content);
      break;
    case 3:
      UART3.write(content);
      break;
    default: break;
  }
  _delay_ms(2); // tx interval, for rx to read
}

void set_port_dir(uint8_t port, uint8_t parent_position) {
  // circulate LEFT->UP->RIGHT->DOWN: 0->1->2->3
  for (uint8_t i = port, j = parent_position, k = 0; k < 4 ; i++, j++, k++) {
    i = (i != 4) ? i : 0;
    j = (j != 4) ? j : 0;
    PORT_DIR[i] = j;
  }
}

uint8_t dir_to_port(uint8_t dir) {
  for (uint8_t i = 0; i < 4; i++) {
    if (PORT_DIR[i] == dir)
      return i;
  }
  return 0xff; // given dir is wrong(not 0~3)
}

void reset() {
  while (true) {
    for (uint8_t i = 0; i < 4; i++) {
      for (uint8_t j = 0; j < 5; j++) {
        writePort(PORT[i], RESET);
        _delay_ms(10);
      }
    }
  }
}

bool connect_check(uint8_t port) {
  // check 5 times
  for (uint8_t i = 0; i < 5; i++) {
    writePort(port, CONNECT_CHK);
    _delay_ms(10);
    if (availablePort(port)) {
      if (readPort(port) ==  CONNECT_Y || readPort(port) == RQ_ADDR)
        return true;
    }
  }
  reset();
  return false;
}

void requestAddress() {
  while (!hasAddress) {
    for (uint8_t i = 0; i < 4; i++) {
      if (!digitalRead(rx[PORT[i]])) { // detect connection
        uint8_t rqCnt = 0; // request times
        listenPort(PORT[i]);
        do {
          writePort(PORT[i], RQ_ADDR);
          rqCnt++;
          if (availablePort(PORT[i])) {
            uint8_t flag = readPort(PORT[i]);
            if (flag == CONTENT_ADDR) {
              while (availablePort(PORT[i]) < 2); // wait for next 2 bytes
              if (availablePort(PORT[i]) >= 2) {
                uint8_t x = readPort(PORT[i]); // column address
                uint8_t y = readPort(PORT[i]); // row address
                myAddress = (x << 8) + y;

                if ( myAddress == plane_center) {
                  parent_position = LEFT; // position of controller
                  // initialize I2C
                  Wire.begin(8);
                  TWAR |= (1 << TWGCE);  // enable broadcasts to be received
                  Wire.onReceive(receiveEvent);

                  disp(G_SS, 15, test_img);

                }
                else {
                  while (availablePort(PORT[i]) < 1);
                  parent_position = readPort(PORT[i]);
                }
                // set relation between port & direction
                set_port_dir(PORT[i], parent_position);
                hasAddress = true;
              }
            }
          }
        } while (rqCnt < 10 && !hasAddress);
      }
    }
  }
}

void  wait_i2cAddr() {
  bool finished = false;
  uint8_t port = dir_to_port(parent_position);
  uint8_t op;
  
  listenPort(port);
  while (!finished) {
    Serial.println("P1");
    while (availablePort(port) < 1);
    op = readPort(port);

    switch (op) {
      case RQ_SEND:
        writePort(port, SEND_ACK);
        break;
      case CONTENT_I2C_ADDR:
        if (myAddress != plane_center) {
          while (availablePort(port) < 1);
          if (availablePort(port)) {
            uint8_t i2c_addr = readPort(port);
            Wire.begin(i2c_addr);
            TWAR |= (1 << TWGCE);  // enable broadcasts to be received - General Call
            Wire.onReceive(receiveEvent);
          }
        }

        disp(G_SS, 15, test_img);

        finished = true;
        break;
    }
  }
}

void sendAddress(uint8_t x, uint8_t y, uint8_t relative_position) {
  uint8_t request = SEND_DENY;
  uint8_t port = dir_to_port(parent_position);
  do {
    listenPort(port);
    writePort(port, RQ_SEND);
    _delay_ms(10);
    if (availablePort(port))
      request = readPort(port);
  } while (request != SEND_ACK);

  writePort(port, CONTENT_ADDR);
  writePort(port, x);
  writePort(port, y);
  writePort(port, relative_position);
}

void sendI2CAddr(uint8_t dir, uint8_t i2c_addr) {
  uint8_t request = SEND_DENY;
  uint8_t port = dir_to_port(dir);
  listenPort(port);
  do { 
    writePort(port, RQ_SEND);
    _delay_ms(10);
    if (availablePort(port))
      request = readPort(port);
  } while (request != SEND_ACK);

  writePort(port, CONTENT_I2C_ADDR);
  writePort(port, i2c_addr);
}

void transform(uint8_t img[8]) {

#if VERSION == 1
  // 90 degree clockwise
  // dir_to_port(LEFT) plus 1(hardware error) times
  for (uint8_t i = 0; i < dir_to_port(LEFT) + 1; i++) {
    uint8_t temp[8] = {0};
    for (uint8_t j = 0; j < 8; j++)
      for (uint8_t k = 0; k < 8; k++)
        if (img[k] & (1 << (7 - j)))
          temp[j] |= (1 << k);
    for (uint8_t x = 0; x < 8; x++)
      img[x] = temp[x];
  }

  // 76543210 into 70123456
  for (uint8_t i = 0; i < 8; i++) {
    for (uint8_t j = 0; j < 3 ; j++) {
      uint8_t temp = img[i];
      if (img[i] & (1 << j))
        img[i] |= (1 << (6 - j));
      else
        img[i] &= ~(1 << (6 - j));

      if (temp & (1 << (6 - j)))
        img[i] |= (1 << j);
      else
        img[i] &= ~(1 << j);
    }
  }
#elif VERSION == 2
  for (uint8_t i = 0; i < dir_to_port(LEFT); i++) {
    uint8_t temp[8] = {0};
    for (uint8_t j = 0; j < 8; j++)
      for (uint8_t k = 0; k < 8; k++)
        if (img[k] & (1 << (7 - j)))
          temp[j] |= (1 << k);
    for (uint8_t x = 0; x < 8; x++)
      img[x] = temp[x];
  }
#endif
}

void action(uint8_t port, uint8_t op) {
  bool finished = false; // RQ_SEND: indicate whether the action is completed

  switch (op) {
    case RQ_ADDR:
      switch (PORT_DIR[port]) {
        case LEFT:
          if ((myAddress / 256 - 1) < 0) // checking whether address is at the boundary
            writePort(port, OUT_OF_BOUND);
          else {
            uint8_t x = myAddress / 256 - 1;
            uint8_t y = myAddress % 256;
            writePort(port, CONTENT_ADDR);
            writePort(port, x); // x address
            writePort(port, y); // y address
            writePort(port, RIGHT); // parent_position
            sendAddress(x, y, RIGHT); // route child address to parent module
          }
          break;
        case UP:
          if ((myAddress % 256 + 1) > 255)
            writePort(port, OUT_OF_BOUND);
          else {
            uint8_t x = myAddress / 256;
            uint8_t y = myAddress % 256 + 1;
            writePort(port, CONTENT_ADDR);
            writePort(port, x);
            writePort(port, y);
            writePort(port, DOWN);
            sendAddress(x, y, DOWN);
          }
          break;
        case RIGHT:
          if ((myAddress / 256 + 1) > 255)
            writePort(port, OUT_OF_BOUND);
          else {
            uint8_t x = myAddress / 256 + 1;
            uint8_t y = myAddress % 256;
            writePort(port, CONTENT_ADDR);
            writePort(port, x);
            writePort(port, y);
            writePort(port, LEFT);
            sendAddress(x, y, LEFT);
          }
          break;
        case DOWN:
          if ((myAddress % 256 - 1) < 0)
            writePort(port, OUT_OF_BOUND);
          else {
            uint8_t x = myAddress / 256;
            uint8_t y = myAddress % 256 - 1;
            writePort(port, CONTENT_ADDR);
            writePort(port, x);
            writePort(port, y);
            writePort(port, UP);
            sendAddress(x, y, UP);
          }
          break;
        default: break;
      }
      while (i2c_addr == i2c_addr_last); // wait for i2c interrupt
      sendI2CAddr(dir, i2c_addr);
      i2c_addr_last = i2c_addr; // save current i2c address
      break;

    case RQ_SEND:
      writePort(port, SEND_ACK);
      while (!finished) {
        if (availablePort(port)) {
          uint8_t flag = readPort(port);
          switch (flag) {
            case RQ_SEND:
              writePort(port, SEND_ACK);
              break;
            case CONTENT_ADDR:
              while (availablePort(port) < 3); // wait for next 3 bytes
              if (availablePort(port) >= 3) {
                uint8_t x = readPort(port);
                uint8_t y = readPort(port);
                uint8_t relative_position = readPort(port);
                sendAddress(x, y, relative_position);
              }
              finished = true;
              break;
            default: break;
          }
        }
      }
      break;
    case RESET:
      reset();
      break;

    default: break;
  }
}
