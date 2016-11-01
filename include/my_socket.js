// REDUCED VERSION of https://github.com/kanaka/websockify/wiki/websock.js

// Load Flash WebSocket emulator if needed

// To force WebSocket emulator even when native WebSocket available
//window.WEB_SOCKET_FORCE_FLASH = true;
// To enable WebSocket emulator debug:
//window.WEB_SOCKET_DEBUG=1;

if (window.WebSocket && !window.WEB_SOCKET_FORCE_FLASH) {
    Websock_native = true;
} else if (window.MozWebSocket && !window.WEB_SOCKET_FORCE_FLASH) {
    Websock_native = true;
    window.WebSocket = window.MozWebSocket;
} else {
    /* no builtin WebSocket so load web_socket.js */

    Websock_native = false;
    (function () {
        window.WEB_SOCKET_SWF_LOCATION = Util.get_include_uri() +
                    "web-socket-js/WebSocketMain.swf";
        if (Util.Engine.trident) {
            Util.Debug("Forcing uncached load of WebSocketMain.swf");
            window.WEB_SOCKET_SWF_LOCATION += "?" + Math.random();
        }
        Util.load_scripts(["web-socket-js/swfobject.js",
                           "web-socket-js/web_socket.js"]);
    }());
}


function Websock() {
"use strict";

var api = {},         // Public API
    websocket = null, // WebSocket object
    mode = 'base64',  // Current WebSocket mode: 'binary', 'base64'
    sQ = [],

    eventHandlers = {
        'message' : function() {},
        'open'    : function() {},
        'close'   : function() {},
        'error'   : function() {}
    };

//
// Private utility routines
//

function encode_message() {
    if (mode === 'binary') {
        // Put in a binary arraybuffer
        return (new Uint8Array(sQ)).buffer;
    } else {
        // base64 encode
        return Base64.encode(sQ);
    }
}

//
// Public Send functions
//

function flush() {
    if (websocket.bufferedAmount !== 0) {
        Util.Debug("bufferedAmount: " + websocket.bufferedAmount);
    }
    if (websocket.bufferedAmount < api.maxBufferedAmount) {
        //Util.Debug("arr: " + arr);
        //Util.Debug("sQ: " + sQ);
        if (sQ.length > 0) {
            websocket.send(encode_message(sQ));
            sQ = [];
        }
        return true;
    } else {
        Util.Info("Delaying send, bufferedAmount: " +
                websocket.bufferedAmount);
        return false;
    }
}

// overridable for testing
function send(arr) {
    Util.Debug(">> send_array: " + arr);
    sQ = sQ.concat(arr);
    return flush();
}

//
// Other public functions

function recv_message(e) {
    Util.Debug(">> recv_message: " + e.data.byteLength + " bytes");

    // MODIFIED: send the data undecoded
    if (mode === 'binary')
        eventHandlers.message(e.data);
    else
        Util.Error("my-socket: NYI: receive non-binary message");

    Util.Debug("<< recv_message");
}


// Set event handlers
function on(evt, handler) {
    eventHandlers[evt] = handler;
}

function init(protocols, ws_schema) {
    sQ         = [];
    websocket  = null;

    var bt = false,
        wsbt = false,
        try_binary = false;

    // Check for full typed array support
    if (('Uint8Array' in window) &&
        ('set' in Uint8Array.prototype)) {
        bt = true;
    }
    // Check for full binary type support in WebSocket
    // Inspired by:
    // https://github.com/Modernizr/Modernizr/issues/370
    // https://github.com/Modernizr/Modernizr/blob/master/feature-detects/websockets/binary.js
    try {
        if (bt && ('binaryType' in WebSocket.prototype ||
                   !!(new WebSocket(ws_schema + '://.').binaryType))) {
            Util.Info("Detected binaryType support in WebSockets");
            wsbt = true;
        }
    } catch (exc) {
        // Just ignore failed test localhost connections
    }

    // Default protocols if not specified
    if (typeof(protocols) === "undefined") {
        if (wsbt) {
            protocols = ['binary', 'base64'];
        } else {
            protocols = 'base64';
        }
    }

    // If no binary support, make sure it was not requested
    if (!wsbt) {
        if (protocols === 'binary') {
            throw("WebSocket binary sub-protocol requested but not supported");
        }
        if (typeof(protocols) === "object") {
            var new_protocols = [];
            for (var i = 0; i < protocols.length; i++) {
                if (protocols[i] === 'binary') {
                    Util.Error("Skipping unsupported WebSocket binary sub-protocol");
                } else {
                    new_protocols.push(protocols[i]);
                }
            }
            if (new_protocols.length > 0) {
                protocols = new_protocols;
            } else {
                throw("Only WebSocket binary sub-protocol was requested and not supported.");
            }
        }
    }

    return protocols;
}

function open(uri, protocols) {
    var ws_schema = uri.match(/^([a-z]+):\/\//)[1];
    protocols = init(protocols, ws_schema);

    websocket = new WebSocket(uri, protocols);
    if (protocols.indexOf('binary') >= 0) {
        websocket.binaryType = 'arraybuffer';
    }

    websocket.onmessage = recv_message;
    websocket.onopen = function() {
        Util.Debug(">> WebSock.onopen");
        if (websocket.protocol) {
            mode = websocket.protocol;
            Util.Info("Server chose sub-protocol: " + websocket.protocol);
        } else {
            mode = 'base64';
            Util.Error("Server select no sub-protocol!: " + websocket.protocol);
        }

        eventHandlers.open();
        Util.Debug("<< WebSock.onopen");
    };
    websocket.onclose = function(e) {
        Util.Debug(">> WebSock.onclose");
        eventHandlers.close(e);
        Util.Debug("<< WebSock.onclose");
    };
    websocket.onerror = function(e) {
        Util.Debug(">> WebSock.onerror: " + e);
        eventHandlers.error(e);
        Util.Debug("<< WebSock.onerror");
    };
}

function close() {
    if (websocket) {
        if ((websocket.readyState === WebSocket.OPEN) ||
            (websocket.readyState === WebSocket.CONNECTING)) {
            Util.Info("Closing WebSocket connection");
            websocket.close();
        }
        websocket.onmessage = function (e) { return; };
    }
}


function constructor() {
    // Configuration settings
    api.maxBufferedAmount = 200;

    api.flush        = flush;
    api.send         = send;

    api.on           = on;
    api.init         = init;
    api.open         = open;
    api.close        = close;

    return api;
}

return constructor();

}
