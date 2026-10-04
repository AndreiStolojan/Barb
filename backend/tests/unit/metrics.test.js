import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import {
  metricsHandler,
  metricsRegistry,
  recordGmailHistoryGap,
  recordGmailMessagesIngested,
  recordGmailPushLatency,
  recordGmailPushNotification,
  recordGmailSync,
  recordGmailWatchRenewal,
  recordScheduledTask,
} from '../../src/monitoring/metrics.js';
import { observeHttpRequests } from '../../src/monitoring/metrics.middleware.js';

test('HTTP metrics use normalized routes and never retain object ids', async () => {
  const req = {
    method: 'GET',
    path: '/api/v1/emails/507f1f77bcf86cd799439011',
    baseUrl: '/api/v1/emails',
    route: { path: '/:id' },
  };
  const res = new EventEmitter();
  res.statusCode = 200;

  observeHttpRequests(req, res, () => {});
  res.emit('finish');

  const output = await metricsRegistry.metrics();
  assert.match(output, /route="\/api\/v1\/emails\/:id"/);
  assert.doesNotMatch(output, /507f1f77bcf86cd799439011/);
});

test('unmatched paths share one bounded route label', async () => {
  for (let index = 0; index < 450; index += 1) {
    const req = { method: 'GET', path: `/api/v1/not-a-route-${index}` };
    const res = new EventEmitter();
    res.statusCode = index % 2 === 0 ? 404 : 429;
    observeHttpRequests(req, res, () => {});
    res.emit('finish');
  }

  const output = await metricsRegistry.metrics();
  assert.match(output, /route="unmatched"/);
  assert.doesNotMatch(output, /not-a-route-/);
  // Two status codes create a fixed counter + histogram series set; 450 paths
  // must not turn into hundreds of label values.
  assert.ok((output.match(/route="unmatched"/g) || []).length < 40);
});

test('unrecognized HTTP methods share the OTHER label', async () => {
  const req = { method: 'METHOD_WITH_UNBOUNDED_INPUT', path: '/api/v1/anything' };
  const res = new EventEmitter();
  res.statusCode = 404;
  observeHttpRequests(req, res, () => {});
  res.emit('finish');

  const output = await metricsRegistry.metrics();
  assert.match(output, /method="OTHER",route="unmatched",status_code="404"/);
  assert.doesNotMatch(output, /METHOD_WITH_UNBOUNDED_INPUT/);
});

test('metrics endpoint returns Prometheus text without application data', async () => {
  const response = {
    headers: {},
    set(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; },
  };

  await metricsHandler({}, response, (error) => { throw error; });

  assert.match(response.headers['Content-Type'], /text\/plain/);
  assert.match(response.body, /secureinbox_http_requests_total/);
  assert.doesNotMatch(response.body, /@|token/i);
});

test('scheduled task metrics use bounded task and result labels', async () => {
  recordScheduledTask({ task: 'auto_sync', result: 'success' });
  recordScheduledTask({ task: 'daily_digest', result: 'failure' });

  const output = await metricsRegistry.metrics();
  assert.match(output, /secureinbox_scheduled_tasks_total\{task="auto_sync",result="success"\} 1/);
  assert.match(output, /secureinbox_scheduled_tasks_total\{task="daily_digest",result="failure"\} 1/);
  assert.match(output, /secureinbox_scheduled_task_last_success_timestamp_seconds\{task="auto_sync"\}/);
  assert.doesNotMatch(output, /application_operations|http_requests_in_flight/);
  assert.throws(() => recordScheduledTask({ task: 'anything_else', result: 'success' }));
  assert.throws(() => recordScheduledTask({ task: 'auto_sync', result: 'maybe' }));
});

test('Gmail sync metrics expose only bounded labels and no mailbox data', async () => {
  recordGmailSync({ mode: 'backfill', result: 'success' });
  recordGmailSync({ mode: 'incremental', result: 'failure' });
  recordGmailSync({ mode: 'resync', result: 'success' });
  recordGmailMessagesIngested(3);
  recordGmailHistoryGap();

  const output = await metricsRegistry.metrics();
  assert.match(output, /secureinbox_gmail_sync_total\{mode="backfill",result="success"\} 1/);
  assert.match(output, /secureinbox_gmail_sync_total\{mode="incremental",result="failure"\} 1/);
  assert.match(output, /secureinbox_gmail_sync_total\{mode="resync",result="success"\} 1/);
  assert.match(output, /secureinbox_gmail_messages_ingested_total 3/);
  assert.match(output, /secureinbox_gmail_history_gap_total 1/);
  assert.throws(() => recordGmailSync({ mode: 'manual', result: 'success' }));
  assert.throws(() => recordGmailSync({ mode: 'backfill', result: 'pending' }));
  assert.throws(() => recordGmailMessagesIngested(-1));
});

test('Gmail push metrics accept only bounded outcomes and numeric latency', async () => {
  recordGmailPushNotification('processed');
  recordGmailPushNotification('duplicate');
  recordGmailWatchRenewal('success');
  recordGmailPushLatency(0.5);

  const output = await metricsRegistry.metrics();
  assert.match(output, /secureinbox_gmail_push_notifications_total\{result="processed"\} 1/);
  assert.match(output, /secureinbox_gmail_push_notifications_total\{result="duplicate"\} 1/);
  assert.match(output, /secureinbox_gmail_watch_renewals_total\{result="success"\} 1/);
  assert.match(output, /secureinbox_gmail_push_latency_seconds_count 1/);
  assert.throws(() => recordGmailPushNotification('mailbox@example.test'));
  assert.throws(() => recordGmailWatchRenewal('retrying'));
  assert.throws(() => recordGmailPushLatency(-1));
});
