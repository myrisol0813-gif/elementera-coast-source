export class OwnerAccessError extends Error {
  constructor(message = '请先完成屋主登录。') {
    super(message);
    this.name = 'OwnerAccessError';
    this.type = 'owner_session_required';
    this.status = 401;
  }
}

export function requireOwnerSession(session) {
  if (!session || typeof session !== 'object') throw new OwnerAccessError();
  return Object.freeze({ actor: 'owner', owner: true });
}
