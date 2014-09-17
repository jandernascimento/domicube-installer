## General
Domi cube bluetooth client (GATT) or Master (connection) getting domi_cube position and other info to publish using MQTT (refer to [MQTT topics]#MQTT_DATA )


## Prerequisities
Linux machine

### Bluetooth setup
   - needs a Bluetooth 4.0 dongle
   - bluez installed with bt 4.0 support - www.bluez.org - On debian based distributions :
   
        sudo apt-get install bluetooth bluez bluez-utils blueman libbluetooth-dev
	    sudo apt-get install libusb-dev libdbus-1-dev libglib2.0-dev
	    
	    # check bluetooth installed
        bluetoothd -v
        
   - to check your setup - with BT4.0 dongle plugged :

        # get local devices and identify your usb dongle
        hcitool dev 
        # Domi cube advertisements messages should be received - its name is SensorTag
        sudo hcitool lescan -i your_bt4.0_dongle 

### Nodejs
Get a nodejs recent version >= 0.10.2 On debian based distributions : 

    sudo apt-get install nodejs
    sudo apt-get install npm
    npm config set registry http://registry.npmjs.org/

For rpi, nodejs version too old, for newer version intall refer : https://learn.adafruit.com/raspberry-pi-hosting-node-red/setting-up-node-dot-js

### MQTT broker
Domi cube communicates with distant remotes using MQTT protocol. It needs an MQTT broker. You can install it on domi_cube 
On debian based distributions : 
    sudo apt-get install mosquitto

## Install
    git clone git@gitlab.inrialpes.fr:creativitylab/cubi_dome.git
    cd cubi_dome/domi_cube_master_software/domi_cube_node/
    npm install
    
If permission blocks install ``` sudo chown -R $USER /usr/local``` http://howtonode.org/introduction-to-npm   
    
    # for debug
    npm install debug 

## Launch domi cube
    #domi cube launched in detection mode - MQTT broker in this case is localhost
    sudo DEBUG=domi_cube_node_launch,domi_cube_node node domi_cube_node_launch.js
    
    #domi cube launched in detection mode - MQTT broker in this case is Eclipse public broker
    sudo DEBUG=domi_cube_node_launch,domi_cube_node DOMI_CUBE_MQTT_URL=mqtt://iot.eclipse.org:1883:1883 node domi_cube_node_launch.js    

## Test domi_cube_node
To run test :

** run enable cube detection threw MQTT and listen domi_cube ** 
    # MQTT broker in this case is localhost
    sudo DEBUG=domi_cube_node_test node domi_cube_node_test.js
    
** run enable cube detection ** 

    # MQTT broker in this case is localhost
    sudo DEBUG=domi_cube_node_launch_test node domi_cube_node_launch_test.js

** listen on domi_cube ** 

    # MQTT broker in this case is localhost
    sudo DEBUG=domi_cube_node_listen_test node domi_cube_node_listen_test.js

## Domi cube published / subscribed data {#MQTT_DATA}
Over MQTT on topic 

** Data published : **
Optionally a place location (cube_place) can be given when launching domi_cube, refer "Domi cube arguments".

- active cube face 'amiqual4home/hmi/cube/(cube_place/)cube_uuid/active_face', string representing unsigned int in [1, 6]
  ex : cube with printed faces
    - '1' man working on computer 
    - '2' no symbol, stop
    - '3' music note
    - '4' question mark
    - '5' night with clouds
    - '6' meal

- current battery level 'amiqual4home/hmi/cube/(cube_place/)cube_uuid/battery_level', string representing unsigned int in [0, 100]
- current dim value amiqual4home/hmi/cube/office/(cube_place/)cube_uuid/dim_value', string representing float with 1 decimal in [-100.0, 100.0] 
- TODO vertical push on cube 'amiqual4home/hmi/cube/office/(cube_place/)cube_uuid/vertical_push', boolean to 1

** Data subscribed : **

- 'amiqual4home/hmi/cube/(cube_place/)cube_uuid/distant' - '1' to enable cube state detection, '2' to stop cub detection

By default data published on : tcp://localhost:1883
To change broker just set variable DOMI_CUBE_MQTT_URL to node, ex :

    sudo DEBUG=domi_cube_node_launch,domi_cube_node DOMI_CUBE_MQTT_URL=tcp://your_broker:1883 node domi_cube_node_launch.js

## Domi cube arguments

|  variable name     |   description                                                     |  example                                                         | 
| ------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------- | 
|  DEBUG             |   enable debug logs for a given module                            | ```DEBUG=domi_cube_node_test```                                  |
| DOMI_CUBE_MQTT_URL |   MQTT broker URL                                                 | ```DOMI_CUBE_MQTT_URL=tcp://your_broker:1883```                  |
| SENSOR_ORIENTATION |   sensor orientation in cube around given axis in ° (clockwise)   | ```SENSOR_ORIENTATION="{\"x\":4,\"y\":-35,\"z\":45}"```          |  
| CUBE_PLACE         |   place where is cube                                             | ```PLACE="amiqual4home_office"```                                |                                                               

## Domi cube reference coordinate system

![alt text](https://gitlab.inrialpes.fr/creativitylab/cubi_dome/raw/master/images/domi_cube_coordinate_system.jpg)

### Domi cube default orientation

When no SENSOR_ORIENTATION parameter given, domi_cube orientation is :
 - x = 0°
 - y = -90°
 - z = 45°

## Domi cube API description
  ### usage

    var DomiCubeNode = require('./domi_cube_node');


__Discover__

    DomiCubeNode.discover(callback);
    
__Initialization for capture__

	domiCubeNode.initialize(callback);

__Disconnect__

    domiCubeNode.disconnect(callback);

__start Position Detection__

    sensorTag.startPositionDetection(callback);

__stop Position Detection__

    sensorTag.stopPositionDetection(callback);

__emitted events__

    DomiCubeEvents.DOMI_CUBE_CONNECTED
    DomiCubeEvents.DOMI_CUBE_DISCONNECTED
    
__distant control commands__

	DomiCubeControlCmdType.START_CUBE_DETECTION
	DomiCubeControlCmdType.STOP_CUBE_DETECTION

__errors_

	DomiCubeErrors.DOMI_CUBE_MANU_DATA_ERR: 'discovered sensortag does not support domi_cube - invalid manufacturer data ',
	DomiCubeErrors.DOMI_CUBE_MQTT_DISCONNECT_ERR: 'disconnect from MQTT broker',
	DomiCubeErrors.DOMI_CUBE_MQTT_CLOSE_ERR: 'connection closed/conncetion problem with MQTT broker',
	DomiCubeErrors.DOMI_CUBE_MQTT_ERR_ERR: 'MQTT error',
	DomiCubeErrors.CUBE_START_POSITION_DETECTION_ERR: 'unable to start cube position detection',
	DomiCubeErrors.CUBE_STOP_POSITION_DETECTION_ERR: 'unable to stop cube position detection',

## References
