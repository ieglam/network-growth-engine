import { execSync } from 'child_process';
import path from 'path';

const now = new Date();
const timestamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  '-',
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
  String(now.getSeconds()).padStart(2, '0'),
].join('');

const filename = `nge-backup-${timestamp}.sql`;
const outPath = path.resolve(__dirname, '..', '..', filename);

console.log(`Backing up database to ${filename} ...`);

try {
  execSync(
    `docker exec nge-postgres pg_dump -U postgres --format=custom network_growth_engine > "${outPath}"`,
    { stdio: ['pipe', 'pipe', 'inherit'], shell: 'cmd.exe' }
  );
  console.log(`Backup saved: ${outPath}`);
} catch {
  console.error('Backup failed. Is the nge-postgres container running?');
  process.exit(1);
}
