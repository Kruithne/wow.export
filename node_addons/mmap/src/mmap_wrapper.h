#ifndef MMAP_WRAPPER_H
#define MMAP_WRAPPER_H

#include <cstddef>
#include <string>

#ifdef _WIN32
	#include <windows.h>
#else
	#include <sys/mman.h>
	#include <unistd.h>
	#include <fcntl.h>
	#include <sys/stat.h>
#endif

enum class MmapProtection {
	READONLY = 1,
	READWRITE = 2
};

enum class MmapFlags {
	PRIVATE = 1,
	SHARED = 2
};

class MmapWrapper {
	public:
	MmapWrapper();
	~MmapWrapper();
	
	bool mapFile(const std::string& filename, MmapProtection protection, MmapFlags flags, size_t offset = 0, size_t length = 0);
	
	bool mapAnonymous(size_t length, MmapProtection protection, MmapFlags flags);
	
	bool unmap();
	
	bool sync(bool async = false);
	
	void* getData() const { return data_; }
	size_t getSize() const { return size_; }
	bool isMapped() const { return data_ != nullptr; }
	
	std::string getLastError() const { return last_error_; }
	
	private:
	void* data_;
	size_t size_;
	std::string last_error_;
	
	#ifdef _WIN32
		HANDLE file_handle_;
		HANDLE map_handle_;
	#else
		int file_descriptor_;
	#endif
	
	void setError(const std::string& message);
	void cleanup();
};

#endif // MMAP_WRAPPER_H