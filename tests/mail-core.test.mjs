import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateJob,validateConfig,callBridge,seal,unseal } from '../supabase/functions/ao-api/mail-core.ts';
