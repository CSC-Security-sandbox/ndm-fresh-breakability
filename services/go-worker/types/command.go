package types

import "time"

// Ops represents a single operation within a command, tracking its execution
// status and arbitrary parameters. Wire-compatible with the TypeScript Ops
// interface in stream-datatypes.ts.
type Ops struct {
	Status string            `json:"status" msgpack:"status"`
	Params map[string]any    `json:"params" msgpack:"params"`
}

// Operations is a map of operation key to Ops, matching the TypeScript
// Operations interface { [key: string]: Ops }.
type Operations map[string]Ops

// CmdMeta holds filesystem metadata for a command's target file or directory.
// Wire-compatible with the TypeScript CmdMeta interface.
type CmdMeta struct {
	Size      int64     `json:"size" msgpack:"size"`
	Mtime     time.Time `json:"mtime" msgpack:"mtime"`
	Atime     time.Time `json:"atime" msgpack:"atime"`
	Ctime     time.Time `json:"ctime" msgpack:"ctime"`
	Birthtime time.Time `json:"birthtime" msgpack:"birthtime"`
	Mode      int       `json:"mode" msgpack:"mode"`
	UID       int       `json:"uid" msgpack:"uid"`
	GID       int       `json:"gid" msgpack:"gid"`
	SID       string    `json:"sid" msgpack:"sid"`
	Inode     int64     `json:"inode" msgpack:"inode"`
	IsSymLink bool      `json:"isSymLink,omitempty" msgpack:"isSymLink,omitempty"`
}

// Cmd represents a single file-level command that is read from / written to a
// Redis stream. Wire-compatible with the TypeScript Cmd class in
// stream-datatypes.ts.
type Cmd struct {
	ID       string     `json:"id" msgpack:"id"`
	FPath    string     `json:"fPath" msgpack:"fPath"`
	Status   string     `json:"status" msgpack:"status"`
	IsDir    bool       `json:"isDir" msgpack:"isDir"`
	Ops      Operations `json:"ops" msgpack:"ops"`
	Metadata *CmdMeta   `json:"metadata,omitempty" msgpack:"metadata,omitempty"`
}

// CommandOperation represents a single operation result within the metadata
// types system. Wire-compatible with the TypeScript CommandOperation class.
type CommandOperation struct {
	Cmd       string    `json:"cmd" msgpack:"cmd"`
	Status    string    `json:"status" msgpack:"status"`
	Error     string    `json:"error,omitempty" msgpack:"error,omitempty"`
	ErrorCode string    `json:"errorCode,omitempty" msgpack:"errorCode,omitempty"`
	Metadata  *MetaData `json:"metadata,omitempty" msgpack:"metadata,omitempty"`
}

// MetaData holds raw filesystem stat metadata. Wire-compatible with the
// TypeScript MetaData class in metadata-types.ts.
type MetaData struct {
	Size      int64     `json:"size" msgpack:"size"`
	Mtime     time.Time `json:"mtime" msgpack:"mtime"`
	Atime     time.Time `json:"atime" msgpack:"atime"`
	Ctime     time.Time `json:"ctime" msgpack:"ctime"`
	Birthtime time.Time `json:"birthtime" msgpack:"birthtime"`
	Mode      int       `json:"mode" msgpack:"mode"`
	UID       int       `json:"uid" msgpack:"uid"`
	GID       int       `json:"gid" msgpack:"gid"`
	SID       string    `json:"sid" msgpack:"sid"`
}

// Command represents a higher-level command that groups multiple operations for
// a given file path. Wire-compatible with the TypeScript Command class in
// metadata-types.ts.
type Command struct {
	FPath      string                      `json:"fPath" msgpack:"fPath"`
	Ops        map[int]CommandOperation     `json:"ops" msgpack:"ops"`
	Status     string                      `json:"status" msgpack:"status"`
	CommandID  string                      `json:"commandId" msgpack:"commandId"`
	RetryCount int                         `json:"retryCount" msgpack:"retryCount"`
}
