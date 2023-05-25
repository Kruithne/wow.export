import os
import time

fn is_process_running(pid string) bool {
	user_os := os.user_os()

	// Sending 0 as a signal does not kill the process, allowing for existence checking.
	// See: http://man7.org/linux/man-pages/man2/kill.2.html

	if user_os == 'linux' {
		out := os.execute('kill -0 ' + pid)
		return out.exit_code == 0
	} else if user_os == 'windows' {
		out := os.execute('tasklist /FI "PID eq ' + pid + '"')

		// tasklist always returns 0, so check output for pid.
		return out.output.contains(pid)
	} else if user_os == 'mac' {
		out := os.execute('ps -p ' + pid)
		return out.exit_code == 0
	}

	return false
}

fn apply_update()! {
	install_dir := os.getwd()
	update_dir := os.join_path(install_dir, '.update')

	println('Install directory: ' + install_dir)
	println('Update directory: ' + update_dir)

	if !os.exists(update_dir) {
		println('Update directory does not exist. No update to apply.')
		return
	}

	os.cp_all(update_dir, install_dir, true)!
	os.rmdir_all(update_dir)!
}

fn launch_application() {
	binary_name := if os.user_os() == 'windows' { 'wow.export.exe' } else { 'wow.export' }

	println('Re-launching main process ' + binary_name + ' (' + os.user_os() + ')')

	mut process := os.new_process(binary_name)
	process.run()
}

fn main() {
	println('Updater has started.')

	args := os.args[1..]
	if args.len == 0 {
		println('No parent PID provided, aborting.')
		return
	}

	pid := args[0]

	println('Waiting for process ' + pid + ' to exit...')

	for {
		if !is_process_running(pid) {
			break
		}

		time.sleep(500 * 1000) // 500ms
	}

	println('Parent process ' + pid + ' has terminated.')

	apply_update()!
	launch_application()
}