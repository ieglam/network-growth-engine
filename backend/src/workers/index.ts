// Bull worker entry point — job processors will be registered here
// See TASK-012 (daily queue), TASK-032 (scoring batch), TASK-059 (hard delete cleanup)

import 'dotenv/config';

console.log('Workers starting... (no jobs registered yet)');
