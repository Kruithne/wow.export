#include <napi.h>
#include "mmap_wrapper.h"
#include <memory>

class MmapObject : public Napi::ObjectWrap<MmapObject> {
	public:
	static Napi::Object Init(Napi::Env env, Napi::Object exports);
	MmapObject(const Napi::CallbackInfo& info);
	
	private:
	static Napi::FunctionReference constructor;
	std::unique_ptr<MmapWrapper> mmap_;
	Napi::Reference<Napi::ArrayBuffer> buffer_ref_;
	
	Napi::Value MapFile(const Napi::CallbackInfo& info);
	Napi::Value MapAnonymous(const Napi::CallbackInfo& info);
	Napi::Value Unmap(const Napi::CallbackInfo& info);
	Napi::Value Sync(const Napi::CallbackInfo& info);
	
	Napi::Value GetData(const Napi::CallbackInfo& info);
	Napi::Value GetSize(const Napi::CallbackInfo& info);
	Napi::Value IsMapped(const Napi::CallbackInfo& info);
	Napi::Value GetLastError(const Napi::CallbackInfo& info);
	
	Napi::Value CreateUint8Array(Napi::Env env);
	
	static void FinalizeBuffer(Napi::Env env, void* data, void* hint);
};

Napi::FunctionReference MmapObject::constructor;

Napi::Object MmapObject::Init(Napi::Env env, Napi::Object exports) {
	Napi::HandleScope scope(env);
	
	Napi::Function func = DefineClass(env, "MmapObject", {
		InstanceMethod("mapFile", &MmapObject::MapFile),
		InstanceMethod("mapAnonymous", &MmapObject::MapAnonymous),
		InstanceMethod("unmap", &MmapObject::Unmap),
		InstanceMethod("sync", &MmapObject::Sync),
		InstanceAccessor("data", &MmapObject::GetData, nullptr),
		InstanceAccessor("size", &MmapObject::GetSize, nullptr),
		InstanceAccessor("isMapped", &MmapObject::IsMapped, nullptr),
		InstanceAccessor("lastError", &MmapObject::GetLastError, nullptr)
	});
	
	constructor = Napi::Persistent(func);
	constructor.SuppressDestruct();
	
	exports.Set("MmapObject", func);
	return exports;
}

MmapObject::MmapObject(const Napi::CallbackInfo& info) : Napi::ObjectWrap<MmapObject>(info), mmap_(std::make_unique<MmapWrapper>()) {}

Napi::Value MmapObject::MapFile(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();
	
	if (info.Length() < 1 || !info[0].IsString()) {
		Napi::TypeError::New(env, "Expected filename as first argument").ThrowAsJavaScriptException();
		return env.Null();
	}
	
	std::string filename = info[0].As<Napi::String>().Utf8Value();
	
	MmapProtection protection = MmapProtection::READONLY;
	MmapFlags flags = MmapFlags::SHARED;
	size_t offset = 0;
	size_t length = 0;
	
	if (info.Length() > 1 && info[1].IsObject()) {
		Napi::Object options = info[1].As<Napi::Object>();
		
		if (options.Has("protection")) {
			std::string prot = options.Get("protection").As<Napi::String>().Utf8Value();
			if (prot == "readwrite" || prot == "rw") {
				protection = MmapProtection::READWRITE;
			}
		}
		
		if (options.Has("flags")) {
			std::string flag = options.Get("flags").As<Napi::String>().Utf8Value();
			if (flag == "private") {
				flags = MmapFlags::PRIVATE;
			}
		}
		
		if (options.Has("offset")) {
			offset = options.Get("offset").As<Napi::Number>().Int64Value();
		}
		
		if (options.Has("length")) {
			length = options.Get("length").As<Napi::Number>().Int64Value();
		}
	}
	
	bool success = mmap_->mapFile(filename, protection, flags, offset, length);
	return Napi::Boolean::New(env, success);
}

Napi::Value MmapObject::MapAnonymous(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();
	
	if (info.Length() < 1 || !info[0].IsNumber()) {
		Napi::TypeError::New(env, "Expected length as first argument").ThrowAsJavaScriptException();
		return env.Null();
	}
	
	size_t length = info[0].As<Napi::Number>().Int64Value();
	
	MmapProtection protection = MmapProtection::READWRITE;
	MmapFlags flags = MmapFlags::PRIVATE;
	
	if (info.Length() > 1 && info[1].IsObject()) {
		Napi::Object options = info[1].As<Napi::Object>();
		
		if (options.Has("protection")) {
			std::string prot = options.Get("protection").As<Napi::String>().Utf8Value();
			if (prot == "readonly" || prot == "r") {
				protection = MmapProtection::READONLY;
			}
		}
		
		if (options.Has("flags")) {
			std::string flag = options.Get("flags").As<Napi::String>().Utf8Value();
			if (flag == "shared") {
				flags = MmapFlags::SHARED;
			}
		}
	}
	
	bool success = mmap_->mapAnonymous(length, protection, flags);
	return Napi::Boolean::New(env, success);
}

Napi::Value MmapObject::Unmap(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();
	
	if (!buffer_ref_.IsEmpty()) {
		buffer_ref_.Reset();
	}
	
	bool success = mmap_->unmap();
	return Napi::Boolean::New(env, success);
}

Napi::Value MmapObject::Sync(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();
	
	bool async = false;
	if (info.Length() > 0 && info[0].IsBoolean()) {
		async = info[0].As<Napi::Boolean>().Value();
	}
	
	bool success = mmap_->sync(async);
	return Napi::Boolean::New(env, success);
}

Napi::Value MmapObject::GetData(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();
	
	if (!mmap_->isMapped()) {
		return env.Null();
	}
	
	return CreateUint8Array(env);
}

Napi::Value MmapObject::GetSize(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();
	return Napi::Number::New(env, static_cast<double>(mmap_->getSize()));
}

Napi::Value MmapObject::IsMapped(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();
	return Napi::Boolean::New(env, mmap_->isMapped());
}

Napi::Value MmapObject::GetLastError(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env();
	return Napi::String::New(env, mmap_->getLastError());
}

Napi::Value MmapObject::CreateUint8Array(Napi::Env env) {
	if (!mmap_->isMapped()) {
		return env.Null();
	}
	
	// create an external ArrayBuffer that wraps the mmap memory without a finalizer
	// MmapWrapper will manage memory cleanup when the object is destroyed
	Napi::ArrayBuffer buffer = Napi::ArrayBuffer::New(env, mmap_->getData(), mmap_->getSize());
	
	buffer_ref_ = Napi::Persistent(buffer); // prevent GC
	
	return Napi::Uint8Array::New(env, mmap_->getSize(), buffer, 0);
}

void MmapObject::FinalizeBuffer(Napi::Env env, void* data, void* hint) {
	// no-op
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
	return MmapObject::Init(env, exports);
}

NODE_API_MODULE(node_mmap, Init)