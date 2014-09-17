var DomiCubeNode = require('./domi_cube_node');
var debug = require('debug')('domi_cube_node_test');
var url = require('url');
var mqtt = require('mqtt');
var async = require('async');

/**************************************
 * Exit handlers
 ***************************************/

process.stdin.resume(); //so the program will not close instantly

function exitHandler(options, err) {
	if (options.cleanup) cleanTest();
	if (err) debug(err.stack);
	if (options.exit) process.exit();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, {
	cleanup: true
}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {
	exit: true
}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {
	exit: true
}));

/**************************************
 * test init
 ***************************************/
var test = {};

debug('start domi_cube_node_test');
mqtt_url = url.parse(process.env.DOMI_CUBE_MQTT_URL || 'mqtt://iot.eclipse.org:1883');

test.client = mqtt.createClient(DomiCubeNode.mqttUrl.port, DomiCubeNode.mqttUrl.hostname);

test.client.on('message', function (topic, message) {
	debug('notification from topic : ' + topic); 
	debug(message);
});

debug('instantiate a domi cube');
test.domiCubeNode = null;

/**************************************
 * Start test scenario
 ***************************************/
debug('start test scenario');

debug('try to discover an advertising domi_cube');
DomiCubeNode.discover(onDomiCubeDiscovered.bind(test));

function onDomiCubeDiscovered(error, discoveredDomiCube){
	debug('a domi_cube has been discovered');
	if(error){
		debug('cannot start test with discovered device, error : ' + error + '. Try to discover another cube');
	}
	else{
		this.domiCubeNode = discoveredDomiCube;
		debug('register MQTT topics');
		this.client.subscribe(this.domiCubeNode.getCubeMQTTTopic('#'));
		var distantControlTopic = this.domiCubeNode.getCubeMQTTTopic(DomiCubeNode.CUBE_DISTANT_CONTROL_TOPIC_SUFFIX);

		async.series([
		              function (callback) {
		            	  debug('start domi_cube launch');
		            	  this.domiCubeNode.initialize(callback);
		              }.bind(test),
		              function (callback) {
		            	  debug('send message to start domi cube detection on topic ' + distantControlTopic);
		            	  //sends message to enable cube
		            	  this.client.publish(distantControlTopic, (DomiCubeNode.DomiCubeControlCmdType.START_CUBE_DETECTION).toString(), {
		            		  qos: 1
		            	  }, function (data) {
		            		  debug('message to enable cube sent');
		            	  });
		            	  callback();
		              }.bind(test),
		              function (callback) {
		            	  debug('wait 2s with cube detection started');
		            	  setTimeout(callback, 2000);
		              },
		              function (callback) {
		            	  debug('send message to stop domi cube detection on topic ' + distantControlTopic);
		            	  //sends message to enable cube
		            	  this.client.publish(distantControlTopic, (DomiCubeNode.DomiCubeControlCmdType.STOP_CUBE_DETECTION).toString(), {
		            		  qos: 1
		            	  }, function (data) {
		            		  debug('message to disable cube sent');
		            	  });
		            	  callback();
		              }.bind(test),
		              function (callback) {
		            	  debug('wait 2s ...');
		            	  setTimeout(callback, 2000);
		              },
		              function (callback) {
		            	  debug('send message to start domi cube detection on topic ' + distantControlTopic);
		            	  //sends message to enable cube
		            	  this.client.publish(distantControlTopic, (DomiCubeNode.DomiCubeControlCmdType.START_CUBE_DETECTION).toString(), {
		            		  qos: 1
		            	  }, function (data) {
		            		  debug('message to enable cube sent');
		            	  });
		            	  callback();
		              }.bind(test),
		              function (callback) {
		            	  debug('wait 2s with cube detection started');
		            	  setTimeout(callback, 2000);
		              },
		              function (callback) {
		            	  debug('disconnect domi cube ');
		            	  this.domiCubeNode.disconnect(callback);
		              }.bind(test),
		              //reconnect it
		              function (callback) {
		            	  debug('reconnect to it...')
		            	  DomiCubeNode.discover(function(error, discoveredDomiCube){
		            		  if(error){
		            			  callback(error);
		            		  }
		            		  else{
		            			  debug('domi_cube discovered');
		            			  this.domiCubeNode = discoveredDomiCube;
		            			  callback();
		            		  }
		            	  }.bind(this));
		              }.bind(test),
		              function (callback) {
		            	  this.domiCubeNode.initialize(callback);
		              }.bind(test),
		              function (callback) {
		            	  debug('send message to start domi cube detection on topic ' + distantControlTopic);
		            	  //sends message to enable cube
		            	  this.client.publish(distantControlTopic, (DomiCubeNode.DomiCubeControlCmdType.START_CUBE_DETECTION).toString(), {
		            		  qos: 1
		            	  }, function (data) {
		            		  debug('message to enable cube sent');
		            	  });
		            	  callback();
		              }.bind(test),
		              ]);

	}
}

function cleanTest() {
	//TODO can fail => native part stopped so no more l2cap when script part try to cleanly disconnect
	debug('clean test');
	if (test !== undefined) {
		if (test.client !== undefined) test.client.end();
		if (test.domiCubeNode !== null) {
			test.domiCubeNode.disconnect();
			test.domiCubeNode = null;
		}
	}
	debug('exited from test');
}