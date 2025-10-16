#include "mmap_wrapper.h"
#include <sstream>

#ifdef _WIN32
#include <iostream>
#else
#include <cerrno>
#include <cstring>
#endif

MmapWrapper::MmapWrapper() : data_(nullptr), size_(0)
#ifdef _WIN32
, file_handle_(INVALID_HANDLE_VALUE), map_handle_(NULL)
#else
, file_descriptor_(-1)
#endif
{
}

MmapWrapper::~MmapWrapper() {
	cleanup();
}

bool MmapWrapper::mapFile(const std::string& filename, MmapProtection protection, MmapFlags flags, size_t offset, size_t length) {
	cleanup();
	
	#ifdef _WIN32
		DWORD access = (protection == MmapProtection::READONLY) ? GENERIC_READ : (GENERIC_READ | GENERIC_WRITE);
		DWORD share = FILE_SHARE_READ | FILE_SHARE_WRITE;
		DWORD creation = OPEN_EXISTING;
		
		file_handle_ = CreateFileA(filename.c_str(), access, share, NULL, creation, FILE_ATTRIBUTE_NORMAL, NULL);
		if (file_handle_ == INVALID_HANDLE_VALUE) {
			setError("Failed to open file: " + filename);
			return false;
		}
		
		if (length == 0) {
			LARGE_INTEGER file_size;
			if (!GetFileSizeEx(file_handle_, &file_size)) {
				setError("Failed to get file size");
				return false;
			}
			size_ = static_cast<size_t>(file_size.QuadPart - offset);
		} else {
			size_ = length;
		}
		
		DWORD protect = (protection == MmapProtection::READONLY) ? PAGE_READONLY : PAGE_READWRITE;
		map_handle_ = CreateFileMappingA(file_handle_, NULL, protect, 0, 0, NULL);
		if (map_handle_ == NULL) {
			setError("Failed to create file mapping");
			return false;
		}
		
		DWORD map_access = (protection == MmapProtection::READONLY) ? FILE_MAP_READ : FILE_MAP_WRITE;
		data_ = MapViewOfFile(map_handle_, map_access, static_cast<DWORD>(offset >> 32), static_cast<DWORD>(offset & 0xFFFFFFFF), size_);
			
		if (data_ == NULL) {
			setError("Failed to map view of file");
			return false;
		}
		
	#else
		int open_flags = (protection == MmapProtection::READONLY) ? O_RDONLY : O_RDWR;
		file_descriptor_ = open(filename.c_str(), open_flags);
		if (file_descriptor_ == -1) {
			setError("Failed to open file: " + filename + " (" + strerror(errno) + ")");
			return false;
		}
		
		if (length == 0) {
			struct stat file_stat;
			if (fstat(file_descriptor_, &file_stat) == -1) {
				setError("Failed to get file size (" + std::string(strerror(errno)) + ")");
				return false;
			}

			size_ = static_cast<size_t>(file_stat.st_size - offset);
		} else {
			size_ = length;
		}
		
		int prot = (protection == MmapProtection::READONLY) ? PROT_READ : (PROT_READ | PROT_WRITE);
		int map_flags = (flags == MmapFlags::PRIVATE) ? MAP_PRIVATE : MAP_SHARED;
		
		data_ = mmap(NULL, size_, prot, map_flags, file_descriptor_, static_cast<off_t>(offset));
		if (data_ == MAP_FAILED) {
			data_ = nullptr;
			setError("Failed to map file (" + std::string(strerror(errno)) + ")");
			return false;
		}
	#endif
		
	return true;
}
	
bool MmapWrapper::mapAnonymous(size_t length, MmapProtection protection, MmapFlags flags) {
	cleanup();
	size_ = length;
	
	#ifdef _WIN32
		DWORD protect = (protection == MmapProtection::READONLY) ? PAGE_READONLY : PAGE_READWRITE;
		map_handle_ = CreateFileMappingA(INVALID_HANDLE_VALUE, NULL, protect, static_cast<DWORD>(length >> 32), static_cast<DWORD>(length & 0xFFFFFFFF), NULL);
		if (map_handle_ == NULL) {
			setError("Failed to create anonymous mapping");
			return false;
		}
		
		DWORD access = (protection == MmapProtection::READONLY) ? FILE_MAP_READ : FILE_MAP_WRITE;
		data_ = MapViewOfFile(map_handle_, access, 0, 0, length);
		if (data_ == NULL) {
			setError("Failed to map anonymous memory");
			return false;
		}
		
	#else
	int prot = (protection == MmapProtection::READONLY) ? PROT_READ : (PROT_READ | PROT_WRITE);
	int map_flags = MAP_ANONYMOUS;
	map_flags |= (flags == MmapFlags::PRIVATE) ? MAP_PRIVATE : MAP_SHARED;
	
	data_ = mmap(NULL, length, prot, map_flags, -1, 0);
	if (data_ == MAP_FAILED) {
		data_ = nullptr;
		setError("Failed to create anonymous mapping (" + std::string(strerror(errno)) + ")");
		return false;
	}
	#endif
		
	return true;
}
	
bool MmapWrapper::unmap() {
	if (!data_) {
		return true;
	}
	
	#ifdef _WIN32
		bool success = true;
		if (data_) {
			success = UnmapViewOfFile(data_) != 0;
			data_ = nullptr;
		}
		
		if (map_handle_) {
			CloseHandle(map_handle_);
			map_handle_ = NULL;
		}
		if (file_handle_ != INVALID_HANDLE_VALUE) {
			CloseHandle(file_handle_);
			file_handle_ = INVALID_HANDLE_VALUE;
		}
		if (!success) {
			setError("Failed to unmap memory");
			return false;
		}
	#else
		if (munmap(data_, size_) == -1) {
			setError("Failed to unmap memory (" + std::string(strerror(errno)) + ")");
			return false;
		}
		data_ = nullptr;
		
		if (file_descriptor_ != -1) {
			close(file_descriptor_);
			file_descriptor_ = -1;
		}
	#endif
	
	size_ = 0;
	return true;
}

bool MmapWrapper::sync(bool async) {
	if (!data_) {
		setError("No mapped memory to sync");
		return false;
	}
	
	#ifdef _WIN32
		if (!FlushViewOfFile(data_, size_)) {
			setError("Failed to sync memory");
			return false;
		}

		if (!async && file_handle_ != INVALID_HANDLE_VALUE) {
			if (!FlushFileBuffers(file_handle_)) {
				setError("Failed to flush file buffers");
				return false;
			}
		}
	#else
		int flags = async ? MS_ASYNC : MS_SYNC;
		if (msync(data_, size_, flags) == -1) {
			setError("Failed to sync memory (" + std::string(strerror(errno)) + ")");
			return false;
		}
	#endif
	
	return true;
}

void MmapWrapper::cleanup() {
	if (data_) {
		unmap();
	}
}

void MmapWrapper::setError(const std::string& message) {
	last_error_ = message;
}