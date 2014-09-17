var DomiCubeNode = require('./domi_cube_node');
var debug = require('debug')('domi_cube_node_launch_test');
var async = require('async');

/************************************************
 * domi_cube_launch.js
 * launches domi_cube in detection state. 
 * Handles a single cube at a given time. If cube
 * disconnects it tries to connect to another cube
 *************************************************/


/**************************************
 * Exit handlers
 ***************************************/

process.stdin.resume(); //so the program will not close instantly

function exitHandler(options, err) {
	if (options.cleanup) cleanCubes();
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

function cleanCubes(){
	debug('clean domi cubes');
	debug(domiCubeNodes);
	for(var currIndex = 0; currIndex < domiCubeNodes.length; currIndex++){
		cleanCube(domiCubeNodes[currIndex]);
	}
	domiCubeNodes = [];
}

function cleanCube(domiCubeNode) {
	debug('clean cube with uuid ' + domiCubeNode._uuid);
	if (domiCubeNode !== null) {
		domiCubeNode.removeAllListeners();
		domiCubeNode.disconnect(function(){
			domiCubeNode = undefined;
			debug('exited from domi_cube launch test');
		});
	}
}

var domiCubeNodes = [];

/**************************************
 * Start domi_cube launch scenario
 ***************************************/
debug('starting domi_cube_launch');
debug('try to discover an advertising domi_cube');
DomiCubeNode.discover(onDomiCubeDiscovered);

function onDomiCubeDeviceDisconnection(){
	var cubeIndex = domiCubeNodes.indexOf(this);
	domiCubeNodes.splice(cubeIndex, 1);
	debug('domi_cube disconnected - try to find another advertising domi_cube');
	DomiCubeNode.discover(onDomiCubeDiscovered);
}

function onDomiCubeDiscovered(error, discoveredDomiCube){
	debug('domi_cube with uuid ' + discoveredDomiCube._uuid + 'discovered');
	if(error){
		debug('cannot start test with discovered device, error : ' + error + '. Try to discover another cube');
		setTimeout(function(){
			//Wait must be inserted due to low level process notification unable to get process events
			DomiCubeNode.discover(onDomiCubeDiscovered);
		}, 500);
	}
	else{
		if(domiCubeNodes.indexOf(discoveredDomiCube) > -1){
			debug('do not connect to a domi_cube already in use');
		}
		else{
			domiCubeNode = discoveredDomiCube;
			domiCubeNodes.push(domiCubeNode);
			domiCubeNode.on(DomiCubeNode.DomiCubeEvents.DOMI_CUBE_DISCONNECTED, onDomiCubeDeviceDisconnection.bind(domiCubeNode));

			async.series([
			              function (callback) {
			            	  debug('start domi_cube launch');
			            	  domiCubeNode.initialize(callback);
			              },
			              function (callback) {
			            	  debug('domi_cube connected - start detection');
			            	  domiCubeNode.startPositionDetection(callback);
			              },
			              function (callback) {
			            	  debug('detection on going...');
			            	  // Insert other things to do...
			              }], function (error, results) {
				if (error) {
					debug('domi_cube_node_launch_test - cube configuration : FAILED - error : ' + error + ' - exiting test...');
					cleanCube(domiCubeNode);
				} else {
					debug('domi_cube_node_launch_test - cube configuration : SUCCESS');
					callback();
				}
			});			
		}
		
		// try to find other cubes - COMMENT IT IF YOU NEED ONLY 1 CUBE
		setTimeout(function(){
			//Wait must be inserted due to low level process notification unable to get process events
			DomiCubeNode.discover(onDomiCubeDiscovered);
		}, 500);
	}
}