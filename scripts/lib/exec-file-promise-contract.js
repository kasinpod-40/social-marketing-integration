import { promisify } from 'node:util';

/**
 * รักษา Promise contract ของ node:child_process.execFile หลังมีการห่อ callback function.
 * Generic util.promisify จะคืน stdout เพียงค่าเดียว แต่ execFile contract ต้องคืน
 * { stdout, stderr } และเปิดเผย child process บน promise.child.
 */
export function attachExecFilePromiseContract(execFile) {
  if (typeof execFile !== 'function') {
    throw new TypeError('execFile promise contract requires a function');
  }

  Object.defineProperty(execFile, promisify.custom, {
    configurable: true,
    value(file, args, options) {
      let child;
      const promise = new Promise((resolve, reject) => {
        child = execFile(file, args, options, (error, stdout, stderr) => {
          if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        });
      });
      promise.child = child;
      return promise;
    },
  });

  return execFile;
}
