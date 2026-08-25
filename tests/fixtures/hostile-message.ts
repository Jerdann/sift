export const HOSTILE_MESSAGE_FIXTURE = Object.freeze({
  subject: '<img src=x onerror="window.hostileExecuted=true">',
  plainText: 'javascript:location="https://attacker.example.test"',
  html: '<script>window.hostileExecuted=true</script><a href="file:///C:/private">Open</a>',
  sender: 'attacker@example.test',
  remoteImage: 'https://attacker.example.test/tracking.gif',
  attemptedChannel: 'filesystem:read-anything',
});
