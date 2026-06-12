/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Spout DirectX sender bindings (Windows only).

	Exposes a minimal interface to share the rendered preview as a Spout sender
	so OBS (with the Spout2 plugin) can consume it as a GPU texture with alpha,
	avoiding the cost of the browser-source/WebP pipeline.
*/

#include <napi.h>
#include "../spout/SpoutDX.h"

static spoutDX* g_sender = nullptr;

// init(name) -> bool : create the sender + D3D11 device.
Napi::Value Init(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();

	std::string name = "wow.export";
	if (info.Length() > 0 && info[0].IsString())
		name = info[0].As<Napi::String>().Utf8Value();

	if (g_sender == nullptr)
		g_sender = new spoutDX();

	bool ok = g_sender->OpenDirectX11();
	if (ok) {
		g_sender->SetSenderName(name.c_str());
		// getImageData provides RGBA, so advertise an RGBA texture.
		g_sender->SetSenderFormat(DXGI_FORMAT_R8G8B8A8_UNORM);
	}

	return Napi::Boolean::New(env, ok);
}

// send(buffer, width, height) -> bool : upload an RGBA pixel buffer.
Napi::Value Send(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();

	if (g_sender == nullptr)
		return Napi::Boolean::New(env, false);

	if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsNumber() || !info[2].IsNumber())
		return Napi::Boolean::New(env, false);

	Napi::Buffer<unsigned char> buf = info[0].As<Napi::Buffer<unsigned char>>();
	unsigned int width = info[1].As<Napi::Number>().Uint32Value();
	unsigned int height = info[2].As<Napi::Number>().Uint32Value();

	if (width == 0 || height == 0)
		return Napi::Boolean::New(env, false);

	if (buf.Length() < (size_t)width * (size_t)height * 4)
		return Napi::Boolean::New(env, false);

	bool ok = g_sender->SendImage(buf.Data(), width, height);
	return Napi::Boolean::New(env, ok);
}

// release() : tear down the sender + device.
Napi::Value Release(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();

	if (g_sender != nullptr) {
		g_sender->ReleaseSender();
		g_sender->CloseDirectX11();
		delete g_sender;
		g_sender = nullptr;
	}

	return env.Undefined();
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
	exports.Set("init", Napi::Function::New(env, Init));
	exports.Set("send", Napi::Function::New(env, Send));
	exports.Set("release", Napi::Function::New(env, Release));
	return exports;
}

NODE_API_MODULE(spout, InitAll)
