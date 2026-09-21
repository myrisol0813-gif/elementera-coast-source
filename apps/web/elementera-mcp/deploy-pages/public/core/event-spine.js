const EVENT_ATTRIBUTES = Object.freeze({
  click: 'data-action',
  submit: 'data-submit',
  input: 'data-input',
  change: 'data-change',
});

const HANDLER_NAMES = Object.freeze({
  click: 'handleAction',
  submit: 'handleSubmit',
  input: 'handleInput',
  change: 'handleChange',
});

export const GLOBAL_EVENT_TYPES = Object.freeze(Object.keys(EVENT_ATTRIBUTES));

function routeParts(value) {
  const route = String(value || '');
  const separator = route.indexOf(':');
  if (separator < 1 || separator === route.length - 1) {
    return { namespace: '', name: '', route: '' };
  }
  return {
    namespace: route.slice(0, separator),
    name: route.slice(separator + 1),
    route,
  };
}

export function eventContext(event) {
  const eventType = String(event?.type || '');
  const attribute = EVENT_ATTRIBUTES[eventType] || '';
  const target = attribute
    ? event?.target?.closest?.(`[${attribute}]`) || null
    : null;
  const parts = routeParts(target?.getAttribute?.(attribute));
  return Object.freeze({
    eventType,
    attribute,
    target,
    ...parts,
  });
}

function normalizedClaim(value) {
  if (!value) return null;
  if (value === true) return Object.freeze({});
  if (typeof value !== 'object') throw new TypeError('event_owner_claim_must_be_boolean_or_object');
  return value;
}

export function createActionEventOwner({
  id,
  priority = 0,
  mountOrder = priority,
  controller,
}) {
  if (!id || !controller) throw new TypeError('event_owner_requires_id_and_controller');
  const lifecycleKeys = ['mount', 'refresh', 'destroy', 'ownsRoute', 'observeEvent', 'refreshOnNavigation'];
  const lifecycleKey = lifecycleKeys.find((key) => key === 'refreshOnNavigation'
    ? controller[key] === true
    : typeof controller[key] === 'function');
  if (lifecycleKey) throw new TypeError(`action_event_owner_requires_stateless_controller:${id}:${lifecycleKey}`);

  return Object.freeze({
    id,
    priority,
    mountOrder,
    ownsEvent(_event, context) {
      const handlerName = HANDLER_NAMES[context.eventType];
      if (context.namespace !== id || typeof controller[handlerName] !== 'function') return false;
      return {
        preventDefault: context.eventType === 'click' || context.eventType === 'submit',
      };
    },
    handleEvent(event, context) {
      const handlerName = HANDLER_NAMES[context.eventType];
      return controller[handlerName](context.name, context.target, event);
    },
    mount() {},
    refresh() {},
    destroy() {},
  });
}

export function createEventSpine({
  root = globalThis.document,
  owners = [],
  eventTypes = GLOBAL_EVENT_TYPES,
  beforeHandle,
  onError = (error) => console.error('[event-spine]', error),
} = {}) {
  if (!root?.addEventListener || !root?.removeEventListener) {
    throw new TypeError('event_spine_requires_event_target');
  }

  const orderedOwners = owners
    .map((owner, index) => ({ owner, index }))
    .sort((left, right) => Number(right.owner.priority || 0) - Number(left.owner.priority || 0)
      || left.index - right.index)
    .map(({ owner }) => owner);
  const lifecycleOwners = owners
    .map((owner, index) => ({ owner, index }))
    .sort((left, right) => Number(right.owner.mountOrder ?? right.owner.priority ?? 0)
      - Number(left.owner.mountOrder ?? left.owner.priority ?? 0)
      || left.index - right.index)
    .map(({ owner }) => owner);
  const ownerIds = new Set();
  for (const owner of orderedOwners) {
    if (!owner?.id || typeof owner.ownsEvent !== 'function' || typeof owner.handleEvent !== 'function') {
      throw new TypeError('event_spine_owner_contract_invalid');
    }
    if (typeof owner.mount !== 'function' || typeof owner.refresh !== 'function' || typeof owner.destroy !== 'function') {
      throw new TypeError(`event_spine_lifecycle_contract_invalid:${owner.id}`);
    }
    if (ownerIds.has(owner.id)) throw new Error(`duplicate_event_owner:${owner.id}`);
    ownerIds.add(owner.id);
  }

  const registeredTypes = [...new Set(eventTypes.map(String))];
  const listeners = new Map();
  const mountedOwners = [];
  let mounted = false;
  let mountContext = Object.freeze({});
  let unsubscribeRouter = null;

  async function dispatch(event) {
    const context = eventContext(event);
    try {
      for (const owner of orderedOwners) {
        if (typeof owner.observeEvent === 'function') owner.observeEvent(event, context);
      }

      for (const owner of orderedOwners) {
        // Ownership is deliberately synchronous so default prevention happens
        // during native event dispatch, before the browser commits its action.
        const claim = normalizedClaim(owner.ownsEvent(event, context));
        if (!claim) continue;

        if (claim.preventDefault) event.preventDefault?.();
        if (claim.stopPropagation) event.stopPropagation?.();
        if (beforeHandle) {
          const gate = beforeHandle(event, context, owner, claim);
          const allowed = gate && typeof gate.then === 'function' ? await gate : gate;
          if (allowed === false) {
            return Object.freeze({ ownerId: owner.id, status: 'cancelled' });
          }
        }

        const result = await owner.handleEvent(event, context, mountContext);
        return Object.freeze({ ownerId: owner.id, status: 'handled', result });
      }
      return Object.freeze({ ownerId: null, status: 'unclaimed' });
    } catch (error) {
      await onError(error, context);
      return Object.freeze({ ownerId: null, status: 'failed', error });
    }
  }

  async function refreshForNavigation(navigation) {
    const context = Object.freeze({ ...mountContext, navigation });
    for (const owner of lifecycleOwners) {
      const relevant = owner.refreshOnNavigation
        || owner.ownsRoute?.(navigation?.current)
        || owner.ownsRoute?.(navigation?.previous);
      if (relevant) await owner.refresh(context);
    }
  }

  async function mount(context = {}) {
    if (mounted) return false;
    mountContext = Object.freeze({ ...context });
    mounted = true;

    for (const type of registeredTypes) {
      const listener = (event) => { void dispatch(event); };
      listeners.set(type, listener);
      root.addEventListener(type, listener);
    }

    const router = mountContext.router;
    if (typeof router?.subscribe === 'function') {
      unsubscribeRouter = router.subscribe((navigation) => refreshForNavigation(navigation).catch((error) => onError(error, {
        eventType: 'navigation',
        route: navigation?.current?.name || navigation?.previous?.name || '',
      })));
    }

    try {
      for (const owner of lifecycleOwners) {
        await owner.mount(mountContext);
        mountedOwners.push(owner);
      }
      return true;
    } catch (error) {
      await unmount();
      throw error;
    }
  }

  async function unmount() {
    if (!mounted) return false;
    for (const [type, listener] of listeners) root.removeEventListener(type, listener);
    listeners.clear();
    unsubscribeRouter?.();
    unsubscribeRouter = null;

    let destroyError = null;
    for (const owner of [...mountedOwners].reverse()) {
      try {
        await owner.destroy(mountContext);
      } catch (error) {
        destroyError ||= error;
      }
    }
    mountedOwners.length = 0;
    mounted = false;
    if (destroyError) throw destroyError;
    return true;
  }

  async function refresh(context = mountContext) {
    for (const owner of lifecycleOwners) await owner.refresh(context);
  }

  return Object.freeze({
    dispatch,
    mount,
    unmount,
    refresh,
    eventTypes: Object.freeze([...registeredTypes]),
    ownerIds: Object.freeze(orderedOwners.map((owner) => owner.id)),
  });
}
