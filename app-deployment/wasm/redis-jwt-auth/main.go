package main

import (
	"encoding/json"

	"github.com/tetratelabs/proxy-wasm-go-sdk/proxywasm"
	"github.com/tetratelabs/proxy-wasm-go-sdk/proxywasm/types"
)

// Configuration structure matching JSON config from EnvoyFilter
type PluginConfig struct {
	IntrospectionURL string `json:"introspection_url"`
	ClientID         string `json:"client_id"`
	ClientSecret     string `json:"client_secret"`
	// Mode removed - always STRICT (JWT required)
}

func main() {
	proxywasm.SetVMContext(&vmContext{})
}

// vmContext is called once per VM (Envoy worker)
type vmContext struct {
	types.DefaultVMContext
}

// NewPluginContext creates a new plugin context for each plugin instance
func (*vmContext) NewPluginContext(contextID uint32) types.PluginContext {
	return &pluginContext{}
}

// pluginContext holds the configuration for this plugin instance
type pluginContext struct {
	types.DefaultPluginContext
	config PluginConfig
}

// OnPluginStart is called when the plugin starts - parse configuration
func (ctx *pluginContext) OnPluginStart(pluginConfigurationSize int) types.OnPluginStartStatus {
	// Get configuration data from EnvoyFilter
	data, err := proxywasm.GetPluginConfiguration()
	if err != nil {
		proxywasm.LogCriticalf("failed to get plugin configuration: %v", err)
		return types.OnPluginStartStatusFailed
	}

	// Parse JSON configuration
	if err := json.Unmarshal(data, &ctx.config); err != nil {
		proxywasm.LogCriticalf("failed to parse plugin configuration: %v", err)
		return types.OnPluginStartStatusFailed
	}

	proxywasm.LogInfof("[Redis JWT Auth] Plugin started with config: introspection_url=%s, client_id=%s, mode=STRICT (JWT required for all)",
		ctx.config.IntrospectionURL, ctx.config.ClientID)

	return types.OnPluginStartStatusOK
}

// NewTcpContext creates a new TCP context for each connection
func (ctx *pluginContext) NewTcpContext(contextID uint32) types.TcpContext {
	return &tcpContext{
		contextID:     contextID,
		pluginContext: ctx,
		buffer:        make([]byte, 0, 1024),
		validated:     false,
	}
}
