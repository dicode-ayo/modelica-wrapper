// Package omc is the client for OpenModelica's interactive ZMQ API.
//
// OMC is launched as a subprocess via `omc --interactive=zmq`. This package
// owns the lifecycle, the request queue (OMC is single-threaded), and typed
// wrappers around the ~80 OMC calls we use.
package omc
