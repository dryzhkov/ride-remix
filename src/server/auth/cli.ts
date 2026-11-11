import { emailSchema } from '../../contracts/auth';
import { authFromEnvironment } from './config';

const [command, rawEmail, ...extra] = process.argv.slice(2);
if (!['invite', 'reinvite', 'revoke'].includes(command ?? '') || !rawEmail || extra.length) {
  console.error('Usage: auth <invite|reinvite|revoke> <email>');
  process.exitCode = 1;
} else {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) { console.error('Enter a valid email address'); process.exitCode = 1; }
  else {
    const auth = authFromEnvironment();
    try {
      if (command === 'revoke') {
        auth.store.revoke(parsed.data, auth.now());
        console.info('Revocation complete.');
      } else if (!auth.allowLogin('operator-cli', parsed.data)) {
        console.error('Invitation rate limit reached. Try again later.'); process.exitCode = 1;
      } else {
        auth.store.invite(parsed.data, auth.now());
        const outcome = await auth.sendLink(parsed.data);
        if (outcome !== 'sent') { console.error('Invitation delivery unavailable. Check provider configuration and delivery quota.'); process.exitCode = 1; }
        else console.info('Invitation sent.');
      }
    } finally { auth.store.close(); }
  }
}
