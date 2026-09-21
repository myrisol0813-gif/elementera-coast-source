export class OwnerAccessError extends Error {
  constructor(message = '请先从海岸网页登录。') {
    super(message);
    this.name = 'OwnerAccessError';
    this.type = 'owner_session_required';
    this.status = 401;
  }
}

export function requireOwnerSession(session) {
  // The signed cookie, version and expiry are already verified by auth.verifySession
  // before any /api route is entered. Route owners only accept that verified object.
  if (!session || typeof session !== 'object') {
    throw new OwnerAccessError();
  }
  return Object.freeze({ actor: 'xiaohan', owner: true });
}
