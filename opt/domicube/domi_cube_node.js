/*jshint esnext: true */

/******************************************************************************
 * @file    domi_cube_node.js
 * @author  Rémi Pincent - INRIA
 * @date    25 avr. 2014
 *
 * @brief cubic hmi interface connected over bluetooth. Based on TI Sensortag.  
 * Publishes its hmi events through an MQTT publication. 
 *
 * Project : domi_cube
 * Contact:  Rémi Pincent - remi.pincent@inria.fr
 *
 * Revision History:
 * TODO_revision history
 *****************************************************************************/

/*********************
 * dependencies
 *********************/
var debug = require('debug')('domi_cube_node');
var SensorTag = require('sensortag');
var mqtt = require('mqtt');
var url = require('url');
var async = require('async');
var events = require('events');
var util = require('util');
var math = require('mathjs');

/**********************************
 * domi cube object defines
 *********************************/
/** two first bytes are for company identifier */
const DOMI_CUBE_MANUFACTURER_DATA = 'Domi3';
const ACCEL_NOTIF_PERIOD_MS = 100;
const ACCEL_SLEEP_NOTIF_PERIOD_MS = 200;
const GYRO_NOTIF_PERIOD_MS = 200;
//540°
const MAX_ANGULAR_POS = 540;
//Angular position min change to send notification
const ANGULAR_CHANGE_NOTIF_CRITERION = 0.5;
//Number of same faces detected before considering current face
//is detected face
const STABILIZED_FACE_CRITERION = 3;
//Squared distance between two accelerometer vectors 
const STABILIZED_ACCEL_VECTOR_DIST = 0.05;
const UNSTABILIZED_ACCEL_VECTOR_DIST = 0.3;
//Squared distance between two angular accel vectors 
const UNSTABILIZED_ROTA_ACCEL_VECTOR_DIST = 5000;
//Criterion to exit sleep mode : if n successive accelerometer significative accel detected => cube must exit sleep mode
const SLEEP_MODE_EXIT_ACCEL_POS_CRITERION = 0;
//Criterion to enter sleep mode : if no movement detected n times, cube starts sleeping
const SLEEP_MODE_ENTER_CRITERION = 150;
//cube moving criterion
const CUBE_MOVING_CRITERION = 0.01;
//vertical movement criterion
const VERTICAL_MOVEMENT_CRITERION = 0.01;

var DomiCubeStates = Object.freeze({
	ROOT: 0,
	IDLE: 1,
	STABILIZED_SLEEP: 2,
	STABILIZED_FACE: 3,
	NOT_STABILIZED: 4,
});

/** cube place */
if(process.env.CUBE_PLACE){
	var cubePlace = process.env.CUBE_PLACE + '/';
}
else{
	var cubePlace = '';
}

/************************************************
 * DomiCubeNode class
 *************************************************/

/** Constructor */

function DomiCubeNode(domiCubeDevice) {
	debug('instantiate domi_cube');

	//Domicubes physical objects connected BT4.0
	this._domiCube = domiCubeDevice;
	this._domiCube.on('reconnect', this.onDeviceReconnect.bind(this));
	this._domiCube.on('connectionDrop', this.onDeviceConnectionDrop.bind(this));
	this._domiCube.on('disconnect', this.onDeviceDisconnect.bind(this));

	this._cubeState = DomiCubeStates.ROOT;

	//keep bluetooth uuid to identify cube
	this._uuid = this._domiCube.uuid;

	/************************
	 * sensortag orientation
	 ************************/
	var rotaVectorArg = process.env.SENSOR_ORIENTATION;
	this._rotaMatrix = {};
	var vectorRot = {};

	if(rotaVectorArg){
		vectorRot = JSON.parse(rotaVectorArg);
		if(vectorRot.x === undefined  || vectorRot.y === undefined || vectorRot.z === undefined){
			throw new Error('invalid SENSOR_ORIENTATION argument given'); 
		}
	}else{
		//default orientation
		vectorRot.x = 0;
		vectorRot.y = -90;
		vectorRot.z = 45;
	}

	//convert in deg
	vectorRot.x = math.unit(vectorRot.x, 'deg');
	vectorRot.y = math.unit(vectorRot.y, 'deg');
	vectorRot.z = math.unit(vectorRot.z, 'deg');

	//Rotation matrix - clockwise rotation as given rotation vector in clockwise
	this._rotaMatrix.xRota = [[1, 0, 0], [0, math.cos(vectorRot.x), math.sin(vectorRot.x)], [0, -math.sin(vectorRot.x), math.cos(vectorRot.x)]];
	this._rotaMatrix.yRota = [[math.cos(vectorRot.y), 0, -math.sin(vectorRot.y)], [0, 1, 0], [math.sin(vectorRot.y), 0, math.cos(vectorRot.y)]];
	this._rotaMatrix.zRota = [[math.cos(vectorRot.z), math.sin(vectorRot.z), 0], [-math.sin(vectorRot.z), math.cos(vectorRot.z), 0], [0, 0, 1]];

	/*********************
	 * cube face detection
	 *********************/
	this._previousAccelVector = [];
	this._cubeGravitationalMatrix = [];
	this._accelStabMeasNb = 0;
	this._activeFace = 0;

	/*********************
	 *  sleep
	 **********************/
	//number of times accel a significative accel 
	//is detected indicating cube is moving in sleep mode
	this._nbSleepAccel = 0;
	//number of times no angular movement detected
	this._nbNoMovementCount = 0;

	/*********************
	 * MQTT
	 *********************/
	//MQTT client
	this._mqttClient = null;

	//Set all bindings - workaround to Nodejs events listener implementation : two same methods binded won't be
	//recognized as same listener
	this._bindings = {};
	this._bindings.onAccelerometerChange = this.onAccelerometerChange.bind(this);
	this._bindings.onGyroscopeChange = this.onGyroscopeChange.bind(this);
	this._bindings.onBatteryLevelChange = this.onBatteryLevelChange.bind(this);
	this._bindings.onMQTTClose = this.onMQTTClose.bind(this);
	this._bindings.onMQTTDisconnect = this.onMQTTDisconnect.bind(this);
	this._bindings.onMQTTError = this.onMQTTError.bind(this);
}
util.inherits(DomiCubeNode, events.EventEmitter);

/******************************************************************
 *  STATIC definitions (public)
 *****************************************************************/

/** Events */
DomiCubeNode.DomiCubeEvents = Object.freeze({
	DOMI_CUBE_CONNECTED:1,
	DOMI_CUBE_DISCONNECTED: 2,
	DOMI_CUBE_CONNECTION_DROP: 3,
});

/** Control commands */
DomiCubeNode.DomiCubeControlCmdType = Object.freeze({
	START_CUBE_DETECTION: 1,
	STOP_CUBE_DETECTION: 2
});

/** Errors */
DomiCubeNode.DomiCubeErrors = Object.freeze({
	DOMI_CUBE_MANU_DATA_ERR: 'discovered sensortag does not support domi_cube - invalid manufacturer data ',
	DOMI_CUBE_MQTT_DISCONNECT_ERR: 'disconnect from MQTT broker',
	DOMI_CUBE_MQTT_CLOSE_ERR: 'connection closed/conncetion problem with MQTT broker',
	DOMI_CUBE_MQTT_ERR_ERR: 'MQTT error',
	CUBE_START_POSITION_DETECTION_ERR: 'unable to start cube position detection',
	CUBE_STOP_POSITION_DETECTION_ERR: 'unable to stop cube position detection',
});

/** MQTT defines */
DomiCubeNode.mqttUrl = url.parse(process.env.DOMI_CUBE_MQTT_URL || 'tcp://localhost:1883');
DomiCubeNode.CUBE_PREFIX_TOPIC = 'amiqual4home/hmi/cube/' + cubePlace;
//All topics
DomiCubeNode.CUBE_DISCOVERED_TOPIC = DomiCubeNode.CUBE_PREFIX_TOPIC + 'discovered_cube';
DomiCubeNode.CUBE_FACE_TOPIC_SUFFIX = 'active_face';
DomiCubeNode.CUBE_BATTERY_LEVEL_TOPIC_SUFFIX =  'battery_level';
DomiCubeNode.CUBE_DIM_VALUE_TOPIC_SUFFIX = 'dim_value';
DomiCubeNode.CUBE_DISTANT_CONTROL_TOPIC_SUFFIX = 'distant';

/**
 * Try to discover some domi cubes
 */
DomiCubeNode.discover = function(callback){
	debug('try to discover an advertising domi_cube');
	var discoveredSensorTag = {};
	var domiCubeNode = {};

	/****************************************
	 * DISCOVER process 
	 * If successful, domi_cube can be used
	 *****************************************/
	async.series([
	              function (callback)
	              {
	            	  //First step discover all available sensortags
	            	  SensorTag.discover(function (sensorTag) {
	            		  //Add first discovered cube and establish a connection
	            		  discoveredSensorTag = sensorTag;
	            		  callback();
	            	  }.bind(this));
	              }.bind(this),

	              function (callback)
	              {
	            	  //check sensortag supports domi_cube - checks its manufacturer data
	            	  if(discoveredSensorTag._peripheral.advertisement.manufacturerData && discoveredSensorTag._peripheral.advertisement.manufacturerData.toString().indexOf(DOMI_CUBE_MANUFACTURER_DATA) > -1){
	            		  debug('discovered sensor tag supports domi_cube');
	          			  debug('domi_cube discovered!!!');
	          			  domiCubeNode = new DomiCubeNode(discoveredSensorTag);
	            		  callback();
	            	  }
	            	  else{
	            		  callback(DomiCubeNode.DomiCubeErrors.DOMI_CUBE_MANU_DATA_ERR);
	            	  }
	              }.bind(this),
	              
	              function (callback)
	              {
	            	  // connect to sensortag
	            	  domiCubeNode._domiCube.connect(function () {
	            		  debug('domi_cube device with uuid' + domiCubeNode._uuid + ' connected');
	            		  debug('start services and chars discovery...');
	            		  callback();
	            	  }.bind(this));
	              }.bind(this),

	              function (callback) {
	            	  //Perform discovery
	            	  domiCubeNode._domiCube.discoverServicesAndCharacteristics(function () {
	            		  debug('all domi_cube services and chars discovered');
	            		  callback();
	            	  }.bind(this));
	              }.bind(this)],

	  // Check discover results...
	  function (error, results) {
		if (error) {
			debug('domi_cube discovery failed ' + error);
			callback(error);
		} else {
			debug('domi_cube discovered!!!');
			callback(null, domiCubeNode);
			// publish domi_cube uuid to topic
			domiCubeNode.publishDomiCubeData(domiCubeNode._uuid, DomiCubeNode.CUBE_DISCOVERED_TOPIC);
		}
	}.bind(this));	
};

/**
 * Return a specific cube MQTT topic containing cube uuid from given suffix
 */
DomiCubeNode.prototype.getCubeMQTTTopic = function(topicSuffix){
	return DomiCubeNode.CUBE_PREFIX_TOPIC + this._uuid + '/' + topicSuffix;
}

/**************************************************************
 * Triggers
 **************************************************************/

/** disconnect domi cube */
DomiCubeNode.prototype.disconnect = function (callback) {
	debug('disconnect domi_cube_node');
	if (this._cubeState === DomiCubeStates.IDLE || this._cubeState === DomiCubeStates.ROOT) {
		this.enterRootState(callback);
	} else if (this._cubeState === DomiCubeStates.STABILIZED_FACE) {
		this.exitStabilizedFaceState();
		this.stopAcceleroCapture(function () {
			this.enterRootState(function () {
				debug('domi_cube disconnected');
				callback();
				this.emit(DomiCubeNode.DomiCubeEvents.DOMI_CUBE_DISCONNECTED);
			}.bind(this));
		}.bind(this));
	} else if (this._cubeState === DomiCubeStates.NOT_STABILIZED || this._cubeState === DomiCubeStates.STABILIZED_SLEEP) {
		this.stopAcceleroCapture(function () {
			this.enterRootState(function () {
				debug('domi_cube disconnected');
				callback();
				this.emit(DomiCubeNode.DomiCubeEvents.DOMI_CUBE_DISCONNECTED);
			}.bind(this));
		}.bind(this));
	} else {
		debug('no action for disconnect in state ' + this._cubeState);
		callback();
	}
};

/** Start cube position detection */
DomiCubeNode.prototype.startPositionDetection = function (callback) {
	if (this._cubeState === DomiCubeStates.IDLE) {
		//needed steps to have detection
		async.series([
		              function (seriesCallback) {
		            	  this.exitIdleState(seriesCallback);
		              }.bind(this),
		              function (seriesCallback) {
		            	  this.enterUnstabilizedState();
		            	  seriesCallback();
		              }.bind(this)], 

		              // handle series results
		              function (error, results) {
			if (error) {
				debug('position detection not started : ' + error);
				callback(CUBE_START_POSITION_DETECTION_ERR);
			} else {
				debug('position detection started');
				callback();
			}
		});
	} else {
		debug('trigger startPositionDetection won\'t result in an action in ' + this._cubeState + ' state');
		callback();
	}
};

/** Stop cube position detection */
DomiCubeNode.prototype.stopPositionDetection = function (callback) {
	if (this._cubeState === DomiCubeStates.STABILIZED_FACE) {
		//needed steps to stop detection
		async.series([
		              function (seriesCallback) {
		            	  //be sure accelero stopped before continuing
		            	  this.stopAcceleroCapture(seriesCallback);
		              }.bind(this),
		              function (seriesCallback) {
		            	  this.exitStabilizedFaceState();
		            	  this.enterIdleState();
		            	  seriesCallback();
		              }.bind(this)],

		              // handle series results
		              function (error, results) {
			if (error) {
				debug('unable to stop detection : ' + error);
				callback(CUBE_STOP_POSITION_DETECTION_ERR);
			} else {
				debug('position detection stopped');
				callback();
			}
		}
		);
	} else if (this._cubeState === DomiCubeStates.NOT_STABILIZED) {
		//needed steps to stop detection
		async.series([
		              function (seriesCallback) {
		            	  //be sure accelero stopped before continuing
		            	  this.stopAcceleroCapture(seriesCallback);
		              }.bind(this),
		              function (seriesCallback) {
		            	  this.enterIdleState();
		            	  seriesCallback();
		              }.bind(this)],

		              // handle series results
		              function (error, results) {
			if (error) {
				debug('unable to stop detection : ' + error);
				callback(CUBE_STOP_POSITION_DETECTION_ERR);
			} else {
				debug('position detection stopped');
				callback();
			}
		}	
		);
	} else {
		debug('trigger stopPositionDetection won\'t result in an action in ' + this._cubeState + ' state');
	}
};

/** Message received */
DomiCubeNode.prototype.onMessageReceived = function (topic, message) {
	debug('message \"' + message + '\" received from topic ' + topic);
	if (topic === this.getCubeMQTTTopic(DomiCubeNode.CUBE_DISTANT_CONTROL_TOPIC_SUFFIX)) {
		this.handleControlMessage(message);
	} else {
		debug('Message of topic ' + topic + ' not handled');
	}
};

/** Handle distant control messages */
DomiCubeNode.prototype.handleControlMessage = function (message) {
	debug('control message : \"' + message + '\" received');
	var controlCmdType = parseInt(message);
	if (isNaN(controlCmdType)) {
		debug('invalid command type');
	} else {
		debug('received ctrl type = ' + controlCmdType);
		switch (controlCmdType) {
		case DomiCubeNode.DomiCubeControlCmdType.START_CUBE_DETECTION:
			this.startPositionDetection(function () {
				debug('position detection started from remote');
			});
			break;

		case DomiCubeNode.DomiCubeControlCmdType.STOP_CUBE_DETECTION:
			this.stopPositionDetection(function () {
				debug('position detection stopped from remote');
			});
			break;

		default:
			debug('control command type : ' + controlCmdType + ' not handled');
		break;
		}
	}
};

/** Go back to reference coordinate system applying rotations to given vector according to sensor position in cube */
DomiCubeNode.prototype.applyRota  = function (vector) {
	//apply x rota
	var rotaVect = math.multiply(this._rotaMatrix.xRota, vector);
	//apply y rota
	rotaVect = math.multiply(this._rotaMatrix.yRota, rotaVect);
	//apply z rota
	return  math.multiply(this._rotaMatrix.zRota, rotaVect);
};

/** Convert coordinates to have a common system reference. Refer to ./README.md for gyro coordinate system and reference 
 *  coordinte system
 */
DomiCubeNode.prototype.convertGyroscopeData  = function (x, y, z) {
	return this.applyRota([y, -x, z]);
};

/** gyroscope change */
DomiCubeNode.prototype.onGyroscopeChange = function (x, y, z) {
	var accelRotaVector = this.convertGyroscopeData(x, y, z);
	var angularSpeed =  -math.multiply(this._cubeGravitationalMatrix, accelRotaVector);

	if (this._cubeState === DomiCubeStates.STABILIZED_FACE) {
		if (this.isRotaMeasUnstabilized(accelRotaVector)) {
			this.exitStabilizedFaceState();
			this.enterUnstabilizedState();
		} else {
			if (this.computeAngularPos(angularSpeed)) {
				//nothing to do - but do not sleep if cube is moving 
				this._nbNoMovementCount = 0;  
			} else {
				if(++this._nbNoMovementCount > SLEEP_MODE_ENTER_CRITERION)
					this.enterSleepMode();
			}
		}
	} else if (this._cubeState === DomiCubeStates.STABILIZED_SLEEP) {
		debug('should not receive gyro notifs when sleeping!');
	} else {
		debug('trigger onGyroscopeChange won\'t result in an action in ' + this._cubeState + ' state');
	}
};

/** Convert coordonates to have a common system reference. Refer to ./README.md for accelero coordinate system and reference 
 *  coordinte system
 */
DomiCubeNode.prototype.convertAcceleroData  = function (x, y, z) {
	return this.applyRota([-x, y, z]);
};

/** accelerometer change */
DomiCubeNode.prototype.onAccelerometerChange = function (origX, origY, origZ) {
	var accelVector = this.convertAcceleroData(origX, origY, origZ);

	debug('in on accelerometer change x = ' + accelVector[0] + ' y = ' + accelVector[1] + ' z = ' + accelVector[2]);

	//differential acceleration from previous accel
	var accelDist = Math.pow(this._previousAccelVector[0] - accelVector[0], 2) + Math.pow(this._previousAccelVector[1] - accelVector[1], 2) + Math.pow(this._previousAccelVector[2] - accelVector[2], 2);

	if (this._cubeState === DomiCubeStates.NOT_STABILIZED) {
		//Check guards
		if (this.isAccelMeasStabilized(accelDist)) {
			debug('DomiCubeStates.NOT_STABILIZED accel stab');
			//Update current number of stab accel measure count
			this._accelStabMeasNb++;
			if (this.isAccelStabilized()) {
				this.enterStabilizedFaceState();
			}
		} else {
			debug('DomiCubeStates.NOT_STABILIZED accel unstab');
			//Reset current number of stab accel measure count
			this._accelStabMeasNb = 0;
		}
	} else if (this._cubeState === DomiCubeStates.STABILIZED_FACE) {
	} else if (this._cubeState === DomiCubeStates.STABILIZED_SLEEP) {
		if (this.isCubeMoving(accelDist)) {
			this.exitSleepMode();
			if(this.isVerticalMovement(accelVector)){
				this.enterUnstabilizedState();
			}
			else{
				this.enterStabilizedFaceState();
			}
		}
	} else {
		debug('trigger onAccelerometerChange won\'t result in an action in ' + this._cubeState + ' state');
	}
	this._previousAccelVector = accelVector;
};

DomiCubeNode.prototype.onBatteryLevelChange = function (level) {
	debug('notification : battery level = ' + level + '%');
	this.publishDomiCubeData(level, this.getCubeMQTTTopic(DomiCubeNode.CUBE_BATTERY_LEVEL_TOPIC_SUFFIX));
};

/** domi cube node reconnected with master*/
DomiCubeNode.prototype.onDeviceReconnect = function () {
	debug('domi_cube reconnected');

	// no idea about what occured during disconnection => enter unstabilized state
	if (this._cubeState === DomiCubeStates.STABILIZED_FACE){
		this.exitStabilizedFaceState();
		this.enterUnstabilizedState();
	} 
	else if (this._cubeState === DomiCubeStates.STABILIZED_SLEEP) {
		this.exitSleepMode();
		this.enterUnstabilizedState();
	}
};

/** domi cube node now disconnected  from master */
DomiCubeNode.prototype.onDeviceDisconnect = function () {
	debug('domi_cube connection with master disconnected');
	//clean device
	this._domiCube.removeAllListeners();
	delete this._domiCube;
	this._domiCube = null;
	//disconnect node
	this.disconnect(this.onDisconnect.bind(this));
};

/** domi cube connection with master dropped  */
DomiCubeNode.prototype.onDeviceConnectionDrop = function () {
	debug('domi_cube connection with master dropped');
	this.emit(DomiCubeNode.DomiCubeEvents.DOMI_CUBE_CONNECTION_DROP);
};


/** domi cube node disconnect */
DomiCubeNode.prototype.onDisconnect = function () {
	debug('domi_cube node now disconnected');
};

/** MQTT events */
DomiCubeNode.prototype.onMQTTDisconnect = function () {
	debug('disconnect from mqtt ');
	//disconnect node
	this.disconnect(this.onDisconnect.bind(this));
};

/** MQTT events */
DomiCubeNode.prototype.onMQTTClose = function () {
	debug('mqtt connection closed');
	//disconnect node
	this.disconnect(this.onDisconnect.bind(this));
};

/** MQTT events */
DomiCubeNode.prototype.onMQTTError = function (error) {
	debug('error from mqtt : ' + error);
	this._mqttClient.end();
};

/**************************************************************
 * GUARDS
 **************************************************************/

/** check if cube is moving from accelerometer distance with previous accel */
DomiCubeNode.prototype.isCubeMoving = function (accelDist) {
	//very simple criterion...
	return accelDist > CUBE_MOVING_CRITERION;
};

/** check if cube vertical acceleration component changed  */
DomiCubeNode.prototype.isVerticalMovement = function (accelVector) {
	//very simple criterion...
	return Math.abs(math.multiply(this._cubeGravitationalMatrix, accelVector) - math.multiply(this._cubeGravitationalMatrix, this._previousAccelVector))  > VERTICAL_MOVEMENT_CRITERION;
};

/** check if given accel stabilized according to previous accel */
DomiCubeNode.prototype.isAccelMeasStabilized = function (accelDist) {
	//very simple criterion...
	return accelDist < STABILIZED_ACCEL_VECTOR_DIST;
};

/** check if given unstabilized according to previous accel - it is not !isAccelMeasStabilized because to exiting a stabilized state must be harder*/
DomiCubeNode.prototype.isAccelMeasUnstabilized = function (accelDist) {
	//very simple criterion...
	return accelDist > UNSTABILIZED_ACCEL_VECTOR_DIST;
};

/** Checks whether accel has been stabilized for a given number of measures */
DomiCubeNode.prototype.isAccelStabilized = function () {
	return this._accelStabMeasNb >= STABILIZED_FACE_CRITERION;
};

/** check if rota leads to an unstabilized cube - it is not !isRotaAccelMeasStabilized : exiting a stabilized state must be harder*/
DomiCubeNode.prototype.isRotaMeasUnstabilized = function (accelRotaVector) {
	//get speed norm on other axes - remove component on interesting axe
	var rotaAccelNorm = Math.pow(accelRotaVector[0], 2) + Math.pow(accelRotaVector[1], 2) + Math.pow(accelRotaVector[2], 2) - Math.pow(math.multiply(this._cubeGravitationalMatrix, accelRotaVector), 2);
	return rotaAccelNorm > UNSTABILIZED_ROTA_ACCEL_VECTOR_DIST;
};

DomiCubeNode.prototype.canExitSleepMode = function () {
	return (this._nbSleepAccel > SLEEP_MODE_EXIT_ACCEL_POS_CRITERION);
};

/**
 * Checks wether a push on active face has been done
 */
DomiCubeNode.prototype.isCubeVertPush = function (accelVector, accelDist) {
	//Vertical movement => vertical acceleration on z axis. 
	//TODO needs more read on accelero
	return false;
};

/**************************************************************
 * ACTIONS 
 **************************************************************/

/** Get cube dominant gravitational matrix */
DomiCubeNode.prototype.getActiveCubeFace = function (acceleroVector) {
	var detectedFace = -1;

	if (acceleroVector[1] <= 0 && Math.abs(acceleroVector[1]) >= Math.abs(acceleroVector[0]) && Math.abs(acceleroVector[1]) >= Math.abs(acceleroVector[2])) {
		this._cubeGravitationalMatrix = [[0, -1, 0]];
		detectedFace = 1;
	} else if (acceleroVector[0] >= 0 && Math.abs(acceleroVector[0]) >= Math.abs(acceleroVector[2]) && Math.abs(acceleroVector[0]) >= Math.abs(acceleroVector[1])) {
		this._cubeGravitationalMatrix = [[1, 0, 0]];
		detectedFace = 3;
	} else if (acceleroVector[2] >= 0 && Math.abs(acceleroVector[2]) >= Math.abs(acceleroVector[0]) && Math.abs(acceleroVector[2]) >= Math.abs(acceleroVector[1])) {
		this._cubeGravitationalMatrix = [[0, 0, 1]];
		detectedFace = 2;
	} else if (acceleroVector[0] <= 0 && Math.abs(acceleroVector[0]) >= Math.abs(acceleroVector[2]) && Math.abs(acceleroVector[0]) >= Math.abs(acceleroVector[1])) {
		this._cubeGravitationalMatrix = [[-1, 0, 0]];
		detectedFace = 4;
	} else if (acceleroVector[2] <= 0 && Math.abs(acceleroVector[2]) >= Math.abs(acceleroVector[0]) && Math.abs(acceleroVector[2]) >= Math.abs(acceleroVector[1])) {
		this._cubeGravitationalMatrix = [[0, 0, -1]];
		detectedFace = 5;
	} else if (acceleroVector[1] >= 0 && Math.abs(acceleroVector[1]) >= Math.abs(acceleroVector[0]) && Math.abs(acceleroVector[1]) >= Math.abs(acceleroVector[2])) {
		this._cubeGravitationalMatrix = [[0, 1, 0]];
		detectedFace = 6;
	} else {
		debug('error : cannot detect active cube face');
	}
	debug('active cube face  = ' + detectedFace);
	return detectedFace;
};

/** compute angular position - returns true if changed */
DomiCubeNode.prototype.computeAngularPos = function (angularSpeed) {
	var ret = false;
	var angularMovement = (angularSpeed) * GYRO_NOTIF_PERIOD_MS / (MAX_ANGULAR_POS * 10);

	if (Math.abs(angularMovement) >= ANGULAR_CHANGE_NOTIF_CRITERION) {
		//Publish angular movement
		this.publishDomiCubeData(angularMovement.toFixed(1), this.getCubeMQTTTopic(DomiCubeNode.CUBE_DIM_VALUE_TOPIC_SUFFIX));
		ret = true;
	} else {
		//Not enough movement - Nothing to do
	}
	return ret;
};

DomiCubeNode.prototype.stopAcceleroCapture = function (callback) {
	if(this._domiCube !== null){
		this._domiCube.disableAccelerometer(function () {
			this._domiCube.unnotifyAccelerometer(function () {
				callback();
			});
		}.bind(this));
	}
	else{
		callback();
		//not paired with doli_cube device
	}
};


/**************************************************************
 * Cube state entry - exit methods
 * cube states : idle - not stabilized - face stabilized - stabilized 
 **************************************************************/
DomiCubeNode.prototype.enterIdleState = function () {
	this._cubeState = DomiCubeStates.IDLE;
	debug('enter Idle state');
};

DomiCubeNode.prototype.enterRootState = function (callback, deviceDisconnected) {
	this._cubeState = DomiCubeStates.ROOT;
	debug('enter root state');
	if (this._mqttClient !== null) {
		this._mqttClient.end();
		this._mqttClient = null;
	}
	if (this._domiCube !== null) {
		debug("disconnect sensortag");
		this._domiCube.disconnect(function () {
			debug('sensortag disconnected');
			//device cleaned in onDeviceDisconnect
			callback();
		}.bind(this));
	} else {
		callback();
	}
};

DomiCubeNode.prototype.enterStabilizedFaceState = function () {
	this._cubeState = DomiCubeStates.STABILIZED_FACE;

	var activeFace = this.getActiveCubeFace(this._previousAccelVector);
	debug("enter StabilizedFaceState - stabilized cube face = " + activeFace);

	if (activeFace != this._activeFace) {
		this._activeFace = activeFace;
		//Publish stabilized face 
		this.publishDomiCubeData(this._activeFace, this.getCubeMQTTTopic(DomiCubeNode.CUBE_FACE_TOPIC_SUFFIX));
	}

	this._domiCube.setGyroscopePeriod(GYRO_NOTIF_PERIOD_MS, function () {});
	//Enable gyro to determine when cube is stabilized in rotation
	this._domiCube.enableGyroscope(function () {
		this._domiCube.notifyGyroscope(function () {});
	}.bind(this));
};

/** exit from face stabilized  */
DomiCubeNode.prototype.exitStabilizedFaceState = function () {
	debug('exit stabilized face state');
	if(this._domiCube !== null){
		//disable gyroscope
		this._domiCube.disableGyroscope(function () {
			this._domiCube.unnotifyGyroscope(function () {});
		}.bind(this));
	}
	else{
		//not paired with a domi_cube device
	}
};


DomiCubeNode.prototype.exitIdleState = function (callback) {
	debug('exit idle state');

	//only activate accelerometer
	this._domiCube.enableAccelerometer(function () {
		this._domiCube.setAccelerometerPeriod(ACCEL_NOTIF_PERIOD_MS, function () {});
		this._domiCube.notifyAccelerometer(callback);

	}.bind(this));
};

DomiCubeNode.prototype.enterUnstabilizedState = function () {
	this._cubeState = DomiCubeStates.NOT_STABILIZED;
	debug('enter unstabilized state');
	this._accelStabMeasNb = 0;
	this._previousAccelVector = [0, 0, 0];
};

DomiCubeNode.prototype.enterSleepMode = function () {
	this._cubeState = DomiCubeStates.STABILIZED_SLEEP;
	debug('enter in sleep mode');
	this._nbNoMovementCount = 0;

	//disable accelero during this phase
	debug('unnotify accelero');
	this._domiCube.unnotifyAccelerometer(function()
			{
		//disable gyroscope
		this._domiCube.disableGyroscope(function () {
			this._domiCube.notifyAccelerometer(function(){
				//increase accelero notif period
				this._domiCube.setAccelerometerPeriod(ACCEL_SLEEP_NOTIF_PERIOD_MS, function () {});
			}.bind(this));
			this._domiCube.unnotifyGyroscope(function () {});
		}.bind(this));	
			}.bind(this));
};

DomiCubeNode.prototype.exitSleepMode = function () {
	debug('exiting sleep mode');

	this._nbSleepAccel = 0;

	//set accelero default period
	this._domiCube.setAccelerometerPeriod(ACCEL_NOTIF_PERIOD_MS, function () {});
};

/**************************************************************
 * initialization
 **************************************************************/

/** Initialize domi_cube for capture */
DomiCubeNode.prototype.initialize = function (callback) {
	/*****************************************************************
	 *Register on services notifications : accelero, gyro and battery
	 *****************************************************************/

	//Accelero
	this._domiCube.on('accelerometerChange', this._bindings.onAccelerometerChange);

	//gyro
	this._domiCube.on('gyroscopeChange', this._bindings.onGyroscopeChange);

	//battery
	this._domiCube.on('batteryLevelChange', this._bindings.onBatteryLevelChange);

	//MQTT start
	this.startMQTTClient(function () {
		debug('MQTT registration successful');
		this._domiCube.notifyBatteryLevel(function () {
			debug('registered to battery level notifications');
		});
		//Initial state
		this.enterIdleState();
		callback();
		this.emit(DomiCubeNode.DomiCubeEvents.DOMI_CUBE_CONNECTED);
	}.bind(this));
};

/**************************************************************
 * Cube distant communication
 **************************************************************/

/** Start domi_cube mqtt client */
DomiCubeNode.prototype.startMQTTClient = function (callback) {
	//MQTT async registration
	debug('creating mqtt client on ' + DomiCubeNode.mqttUrl.hostname);
	this._mqttClient = mqtt.createClient(DomiCubeNode.mqttUrl.port, DomiCubeNode.mqttUrl.hostname);

	//register mqtt events
	this._mqttClient.on('disconnect', this._bindings.onMQTTDisconnect);
	this._mqttClient.on('close', this._bindings.onMQTTClose);
	this._mqttClient.on('error', this._bindings.onMQTTError);

	debug('subscribes to MQTT command topic ' + this.getCubeMQTTTopic(DomiCubeNode.CUBE_DISTANT_CONTROL_TOPIC_SUFFIX));
	this._mqttClient.subscribe(this.getCubeMQTTTopic(DomiCubeNode.CUBE_DISTANT_CONTROL_TOPIC_SUFFIX), function () {
		debug("subscribed to topic " + this.getCubeMQTTTopic(DomiCubeNode.CUBE_DISTANT_CONTROL_TOPIC_SUFFIX));

		//Now register callback for received messages
		this._mqttClient.on('message', this.onMessageReceived.bind(this));
		callback();
	}.bind(this));
};


/** Publish node hmi data over MQTT */
DomiCubeNode.prototype.publishDomiCubeData = function (data, topic) {
	debug('publish data ' + data.toString() + ' to topic ' + topic + ' on ' + DomiCubeNode.mqttUrl.hostname + ':' + DomiCubeNode.mqttUrl.port);
	// publish a message to given topic
	//qos = 1 corresponding to at least once delivery
	this._mqttClient.publish(topic, data.toString(), {
		qos: 1
	}, function () {
		debug('msg published data = ' + data);
	});
};

module.exports = DomiCubeNode;
