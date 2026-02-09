package types

import "time"

// ItemMeta holds per-side (source or target) metadata for an item.
// Wire-compatible with the TypeScript ItemMeta interface in stream-datatypes.ts.
type ItemMeta struct {
	BirthTime    time.Time `json:"birthTime" msgpack:"birthTime"`
	ModifiedTime time.Time `json:"modifiedTime" msgpack:"modifiedTime"`
	AccessTime   time.Time `json:"accessTime" msgpack:"accessTime"`
	Permission   string    `json:"permission" msgpack:"permission"`
	SID          string    `json:"sid,omitempty" msgpack:"sid,omitempty"`
	UID          int       `json:"uid,omitempty" msgpack:"uid,omitempty"`
	GID          int       `json:"gid,omitempty" msgpack:"gid,omitempty"`
	Checksum     string    `json:"checksum,omitempty" msgpack:"checksum,omitempty"`
}

// ItemInfo describes a single file-system entry (file, directory, symlink)
// along with its source and target metadata. Wire-compatible with the
// TypeScript ItemInfo class in stream-datatypes.ts.
type ItemInfo struct {
	FileName      string    `json:"fileName" msgpack:"fileName"`
	IsDirectory   bool      `json:"isDirectory" msgpack:"isDirectory"`
	IsSymbolicLink bool     `json:"isSymbolicLink" msgpack:"isSymbolicLink"`
	Depth         int       `json:"depth" msgpack:"depth"`
	Extension     string    `json:"extension" msgpack:"extension"`
	FileType      string    `json:"fileType" msgpack:"fileType"`
	SourceMeta    ItemMeta  `json:"sourceMeta" msgpack:"sourceMeta"`
	TargetMeta    ItemMeta  `json:"targetMeta" msgpack:"targetMeta"`
	Size          int64     `json:"size" msgpack:"size"`
	Inode         int64     `json:"inode" msgpack:"inode"`
	IsDeleted     bool      `json:"isDeleted" msgpack:"isDeleted"`
}

// FileInfo describes a file-system entry with full path information and
// ownership details. Wire-compatible with the TypeScript FileInfo class in
// metadata-types.ts.
type FileInfo struct {
	FileName     string    `json:"fileName" msgpack:"fileName"`
	Path         string    `json:"path" msgpack:"path"`
	ParentPath   string    `json:"parentPath" msgpack:"parentPath"`
	IsDirectory  bool      `json:"isDirectory" msgpack:"isDirectory"`
	FileSize     int64     `json:"fileSize" msgpack:"fileSize"`
	IsFile       bool      `json:"isFile" msgpack:"isFile"`
	BirthTime    time.Time `json:"birthTime" msgpack:"birthTime"`
	ModifiedTime time.Time `json:"modifiedTime" msgpack:"modifiedTime"`
	AccessTime   time.Time `json:"accessTime" msgpack:"accessTime"`
	Extension    string    `json:"extension" msgpack:"extension"`
	Permission   string    `json:"permission" msgpack:"permission"`
	FileType     string    `json:"fileType" msgpack:"fileType"`
	Depth        int       `json:"depth" msgpack:"depth"`
	UID          int       `json:"uid,omitempty" msgpack:"uid,omitempty"`
	GID          int       `json:"gid,omitempty" msgpack:"gid,omitempty"`
	SID          string    `json:"sid,omitempty" msgpack:"sid,omitempty"`
}

// SpeedTestReadWriteInfo holds a single speed-test measurement data point.
// Wire-compatible with the TypeScript SpeedTestReadWriteInfo class in
// metadata-types.ts.
type SpeedTestReadWriteInfo struct {
	Timestamp string `json:"timeStamp" msgpack:"timeStamp"`
	Speed     string `json:"speed" msgpack:"speed"`
	TestType  string `json:"testType" msgpack:"testType"`
	JobRunID  string `json:"jobRunId" msgpack:"jobRunId"`
}
