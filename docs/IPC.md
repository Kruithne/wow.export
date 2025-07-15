# Inter-Process Communication (IPC)

This document provides technical documentation for the protobuf-based IPC system used for communication between the wow.export components: `/core`, `/cli`, and `/gui`.

## Overview

The IPC system uses Protocol Buffers (protobuf) for structured communication between processes. The `/core` component acts as a server that processes requests from client components (`/cli` and `/gui`), communicating via stdin/stdout using a length-prefixed binary protocol.

## Architecture

```
┌─────────┐    protobuf     ┌──────────┐    protobuf     ┌─────────┐
│   CLI   │ ──────────────► │   CORE   │ ◄────────────── │   GUI   │
│ (client)│                 │ (server) │                 │(client) │
└─────────┘                 └──────────┘                 └─────────┘
```

- **Core**: Standalone executable that processes requests and manages game data
- **CLI**: Command-line interface that spawns and communicates with core
- **GUI**: Electron-based interface that spawns and communicates with core

## Wire Protocol

Messages are transmitted using a length-prefixed binary format:

1. **Length Header**: 4 bytes (uint32, little-endian) indicating message payload size
2. **Protobuf Payload**: Serialized protobuf message

### Example Wire Format
```
[Length: 4 bytes][Protobuf Message: N bytes]
[0x0A 0x00 0x00 0x00][protobuf data...]
```

## Message Types

All messages are defined in `/proto/messages.proto` and wrapped in an `IpcMessage` envelope:

### IpcMessage
```protobuf
message IpcMessage {
  oneof message {
    HandshakeRequest handshake_request = 1;
    HandshakeResponse handshake_response = 2;
    RegionListRequest region_list_request = 3;
    RegionListResponse region_list_response = 4;
  }
}
```

### HandshakeRequest
Initiates connection and provides identification client ID to core

- **Direction**: CLIENT → CORE
- **Expects Response**: `HandshakeResponse`

```protobuf
message HandshakeRequest {
  string version = 1;
}
```

### HandshakeResponse 
Confirms connection and provides core version to client

- **Direction**: CORE → CLIENT
- **Response To**: `HandshakeRequest`

`Direction: CORE → CLIENT`

```protobuf
message HandshakeResponse {
  string version = 1;
}
```

### RegionListRequest 
Requests available Blizzard CDN regions

- **Direction**: CLIENT → CORE
- **Expects Response**: `RegionListResponse`

```protobuf
message RegionListRequest {
  // Empty message
}
```

### RegionListResponse
Provides available Blizzard CDN regions

- **Direction**: CORE → CLIENT
- **Response To**: `RegionListRequest`

```protobuf
message RegionListResponse {
  repeated CDNRegionProto regions = 1;
}

message CDNRegionProto {
  string id = 1;
  string display_name = 2;
  string patch_host_template = 3;
  string ribbit_host_template = 4;
}
```

## Protobuf Compilation

**Location**: `/compile_protobuf.js`

The protobuf definitions are compiled automatically:
- **C#**: Uses built-in protobuf compiler during `dotnet build`
- **JavaScript**: Uses `pbjs` to generate `/gui/src/proto/messages.js`

### Compilation Command
```bash
pbjs -t static-module -w commonjs -o gui/src/proto/messages.js proto/messages.proto
```