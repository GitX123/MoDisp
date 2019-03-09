[wifi]
sudo nmcli device wifi connect <ssid> password <password> ifname wlan0
sudo nmcli device wifi connect "Obtaining IP address..." password 3.141592 ifname wlan0

[start]
MoDisp/init.sh

[i2cdetect]
/usr/sbin/i2cdetect -y 1

[shutdown]
sudo halt