// Command server is the modelica-wrapper backend: a JSON-RPC 2.0 server
// that wraps OpenModelica (OMC) and OMSimulator for the VSCode extension.
//
// Talks to the extension host over stdio. Spawns omc --interactive=zmq as a
// subprocess and proxies a typed RPC layer above OMC's API.
package main

import (
	"fmt"
	"os"
)

const version = "0.0.1"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Println(version)
		return
	}
	fmt.Fprintln(os.Stderr, "modelica-wrapper backend: not yet implemented")
	os.Exit(1)
}
