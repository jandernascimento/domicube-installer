var debug = require('debug')('domi_cube_node_listen_test');
var url = require('url');
var mqtt = require('mqtt');
var DomiCubeNode = require('./domi_cube_node');

/************************************************
 * domi_cube_listen.js
 * listen on domi_cube 
 *************************************************/


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

function cleanTest(){
	if(client !== undefined){
		client.end(); 
	}
}

/**************************************
 * Test functions
 ***************************************/
function onDisconnect(packet){
	debug('MQTT MONITOR disconnect!'+packet);            
}

function onClose(packet){
	debug('MQTT MONITOR close!'+packet); 
}

function onError(err){
	debug('MQTT MONITORerror!'+err);        
}
/**************************************
 * test scenario
 ***************************************/
debug('start domi_cube_listen_test');

debug('create MQTT client listening on ' + DomiCubeNode.mqttUrl.hostname + ':' + DomiCubeNode.mqttUrl.port);
var client = mqtt.createClient(DomiCubeNode.mqttUrl.port, DomiCubeNode.mqttUrl.hostname);
client.on('message', function (topic, message) {
	debug('notification from topic : ' + topic); 

	if(topic.indexOf(DomiCubeNode.CUBE_FACE_TOPIC_SUFFIX, topic.length - DomiCubeNode.CUBE_FACE_TOPIC_SUFFIX.length) !== -1){
		debug('active cube face for cube ' + message);
	}
	else if(topic.indexOf(DomiCubeNode.CUBE_BATTERY_LEVEL_TOPIC_SUFFIX, topic.length - DomiCubeNode.CUBE_BATTERY_LEVEL_TOPIC_SUFFIX.length) !== -1){
		debug('cube battery level = ' + message + '%');
	}
	else if(topic.indexOf(DomiCubeNode.CUBE_DIM_VALUE_TOPIC_SUFFIX, topic.length - DomiCubeNode.CUBE_DIM_VALUE_TOPIC_SUFFIX.length) !== -1){
		debug('cube dim value = ' + message);
	}
	else{
		debug('data not handled');
	}
});

client.on('disconnect', onDisconnect);
client.on('close', onClose);
client.on('error', onError);

debug('register all domi cube MQTT topics : ' + DomiCubeNode.CUBE_PREFIX_TOPIC+ "#");
client.subscribe(DomiCubeNode.CUBE_PREFIX_TOPIC + "#");