import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  GLOBAL_EVENT_TYPES,
  createActionEventOwner,
  createEventSpine,
  eventContext,
} from '../elementera-mcp/deploy-pages/public/core/event-spine.js';

function event(type, target) {
  return {
    type,
    target,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
}

const registrations = new Map();
const fakeRoot = {
  addEventListener(type, listener) {
    registrations.set(type, [...(registrations.get(type) || []), listener]);
  },
  removeEventListener(type, listener) {
    registrations.set(type, (registrations.get(type) || []).filter((value) => value !== listener));
  },
};
const registrationSpine = createEventSpine({ root: fakeRoot });
assert.equal(await registrationSpine.mount(), true);
assert.equal(await registrationSpine.mount(), false, 'mount is idempotent');
assert.deepEqual(registrationSpine.eventTypes, ['click', 'submit', 'input', 'change']);
assert.deepEqual(GLOBAL_EVENT_TYPES, registrationSpine.eventTypes);
for (const type of GLOBAL_EVENT_TYPES) {
  assert.equal(registrations.get(type)?.length, 1, `${type} must have one global registration`);
}
assert.equal(await registrationSpine.unmount(), true);
for (const type of GLOBAL_EVENT_TYPES) assert.equal(registrations.get(type)?.length, 0);

const window = new Window({ url: 'https://coast.test/' });
const { document } = window;
document.body.innerHTML = `
  <button id="dailyHome" data-action="daily:home"><span>日报</span></button>
  <form id="dailyForm" data-submit="daily:save"><input name="title"></form>
  <input id="dailyInput" data-input="daily:filter">
  <select id="dailyChange" data-change="daily:mode"><option>coast</option></select>
  <a id="nativeLink" href="/native">native</a>`;

assert.deepEqual(eventContext(event('click', document.querySelector('#dailyHome span'))), {
  eventType: 'click',
  attribute: 'data-action',
  target: document.querySelector('#dailyHome'),
  namespace: 'daily',
  name: 'home',
  route: 'daily:home',
});

const calls = [];
const controller = {
  handleAction(name, target) { calls.push(['click', name, target.id]); },
  handleSubmit(name, target) { calls.push(['submit', name, target.id]); },
  handleInput(name, target) { calls.push(['input', name, target.id]); },
  handleChange(name, target) { calls.push(['change', name, target.id]); },
};
const actionOwner = createActionEventOwner({
  id: 'daily',
  priority: 70,
  controller,
});
assert.throws(() => createActionEventOwner({ id: 'bad-wrapper', controller: { handleAction() {}, mount() {} } }), /action_event_owner_requires_stateless_controller:bad-wrapper:mount/);
const actionSpine = createEventSpine({ root: document, owners: [actionOwner] });

for (const [type, selector, prevented] of [
  ['click', '#dailyHome span', true],
  ['submit', '#dailyForm input', true],
  ['input', '#dailyInput', false],
  ['change', '#dailyChange', false],
]) {
  const routedEvent = event(type, document.querySelector(selector));
  const outcome = await actionSpine.dispatch(routedEvent);
  assert.equal(outcome.ownerId, 'daily');
  assert.equal(outcome.status, 'handled');
  assert.equal(routedEvent.defaultPrevented, prevented, `${type} default policy changed`);
}
assert.deepEqual(calls, [
  ['click', 'home', 'dailyHome'],
  ['submit', 'save', 'dailyForm'],
  ['input', 'filter', 'dailyInput'],
  ['change', 'mode', 'dailyChange'],
]);

const nativeEvent = event('click', document.querySelector('#nativeLink'));
assert.equal((await actionSpine.dispatch(nativeEvent)).status, 'unclaimed');
assert.equal(nativeEvent.defaultPrevented, false, 'unclaimed native events must pass through');

const priorityCalls = [];
const highOwner = {
  id: 'modal',
  priority: 100,
  ownsEvent: () => ({ preventDefault: true }),
  handleEvent: () => { priorityCalls.push('modal'); },
  mount() {},
  refresh() {},
  destroy() {},
};
const lowOwner = {
  id: 'legacy',
  priority: 10,
  ownsEvent: () => ({ preventDefault: true }),
  handleEvent: () => { priorityCalls.push('legacy'); },
  mount() {},
  refresh() {},
  destroy() {},
};
const prioritySpine = createEventSpine({ root: document, owners: [lowOwner, highOwner] });
const priorityEvent = event('click', document.querySelector('#dailyHome'));
assert.deepEqual(await prioritySpine.dispatch(priorityEvent), {
  ownerId: 'modal',
  status: 'handled',
  result: undefined,
});
assert.deepEqual(priorityCalls, ['modal'], 'one event must have one owner');
assert.equal(priorityEvent.defaultPrevented, true);

let gatedHandlerCalls = 0;
const gatedOwner = {
  id: 'danger-gate',
  priority: 100,
  ownsEvent: () => ({ preventDefault: true }),
  handleEvent: () => { gatedHandlerCalls += 1; },
  mount() {},
  refresh() {},
  destroy() {},
};
const gatedSpine = createEventSpine({
  root: document,
  owners: [gatedOwner],
  beforeHandle: async () => false,
});
const gatedEvent = event('click', document.querySelector('#dailyHome'));
assert.deepEqual(await gatedSpine.dispatch(gatedEvent), { ownerId: 'danger-gate', status: 'cancelled' });
assert.equal(gatedEvent.defaultPrevented, true, 'a claimed gated event remains owned');
assert.equal(gatedHandlerCalls, 0);

assert.throws(() => createEventSpine({
  root: document,
  owners: [highOwner, { ...highOwner }],
}), /duplicate_event_owner:modal/);
assert.throws(() => createEventSpine({
  root: document,
  owners: [{ id: 'broken', ownsEvent() {}, handleEvent() {}, mount() {}, refresh() {} }],
}), /event_spine_lifecycle_contract_invalid:broken/);

const lifecycleCalls = [];
let navigationListener = null;
const lifecycleRouter = {
  subscribe(listener) {
    navigationListener = listener;
    return () => { navigationListener = null; };
  },
};
const routeOwner = {
  id: 'route-owner',
  priority: 70,
  mountOrder: 10,
  ownsRoute(route) { return route?.name === 'feature-home'; },
  ownsEvent() { return false; },
  handleEvent() {},
  mount(context) { lifecycleCalls.push(`mount:route:${context.marker}`); },
  refresh(context) { lifecycleCalls.push(`refresh:route:${context.navigation.reason}`); },
  destroy() { lifecycleCalls.push('destroy:route'); },
};
const navigationOwner = {
  id: 'navigation-owner',
  priority: 90,
  mountOrder: 20,
  refreshOnNavigation: true,
  ownsEvent() { return false; },
  handleEvent() {},
  mount(context) { lifecycleCalls.push(`mount:navigation:${context.marker}`); },
  refresh(context) { lifecycleCalls.push(`refresh:navigation:${context.navigation.reason}`); },
  destroy() { lifecycleCalls.push('destroy:navigation'); },
};
const lifecycleSpine = createEventSpine({
  root: document,
  owners: [routeOwner, navigationOwner],
});
await lifecycleSpine.mount({ router: lifecycleRouter, marker: 'coast' });
assert.deepEqual(lifecycleCalls, ['mount:navigation:coast', 'mount:route:coast'], 'mount order is explicit and independent of event priority');
await navigationListener({ reason: 'open', current: { name: 'feature-home' }, previous: null });
await navigationListener({ reason: 'open', current: { name: 'other-home' }, previous: { name: 'feature-home' } });
assert.deepEqual(lifecycleCalls.slice(2), [
  'refresh:navigation:open',
  'refresh:route:open',
  'refresh:navigation:open',
  'refresh:route:open',
], 'navigation refreshes always-on owners plus owners entering or leaving their routes');
await lifecycleSpine.unmount();
assert.deepEqual(lifecycleCalls.slice(-2), ['destroy:route', 'destroy:navigation'], 'destroy runs in reverse mount order');
assert.equal(navigationListener, null, 'router subscription is removed on unmount');

console.log('event-spine: ok');
