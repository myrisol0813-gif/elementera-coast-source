// Message history is the authority for attachment authorship; a filename or
// attachment row alone cannot prove who sent an image.
export function attachmentOrigin(state, row) {
  if (!row.turn_id) return { role:null, messageId:null, status:'unlinked' };
  const turn = (state?.turns || []).find(t => t.id === row.turn_id);
  if (!turn) return { role:null, messageId:null, status:'missing' };
  const refs = [];
  for (const [role,variants] of [['user',turn.user?.variants || []],['assistant',Object.values(turn.assistant?.variantsByUserVariant || {}).flat()]]) {
    for (const v of variants) if (v.attachments?.some(a => a.id === row.id && a.type === row.kind && a.name === row.name && a.mime === row.mime && Number(a.size) === Number(row.size))) refs.push({role,messageId:v.id});
  }
  const roles = new Set(refs.map(r=>r.role));
  if (roles.size !== 1) return {role:null,messageId:null,status:refs.length?'ambiguous':'unlinked'};
  const ids = [...new Set(refs.map(r=>r.messageId))];
  return {role:refs[0].role,messageId:ids.length===1?ids[0]:null,status:ids.length===1?'linked':'multiple_variants'};
}
