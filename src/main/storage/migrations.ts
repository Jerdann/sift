import type BetterSqlite3 from 'better-sqlite3';

interface Migration {
  version: number;
  statements: string;
  foreignKeysOff?: boolean;
}

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    version: 1,
    statements: `
      CREATE TABLE secret_refs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'verification_mismatch')
        ),
        idempotency_key TEXT NOT NULL UNIQUE,
        total_items INTEGER NOT NULL DEFAULT 0 CHECK (total_items >= 0),
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        checkpoint_json TEXT,
        error_code TEXT
      );

      CREATE TABLE job_items (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        item_key TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'verification_mismatch')
        ),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        prior_state_json TEXT,
        target_state_json TEXT,
        result_json TEXT,
        error_code TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(job_id, item_key)
      );

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        job_item_id TEXT REFERENCES job_items(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        safe_payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX jobs_profile_state_idx ON jobs(profile_id, state);
      CREATE INDEX job_items_job_state_idx ON job_items(job_id, state);
      CREATE INDEX audit_events_job_created_idx ON audit_events(job_id, created_at);
      CREATE INDEX secret_refs_profile_purpose_idx ON secret_refs(profile_id, purpose);
    `,
  },
  {
    version: 2,
    statements: `
      CREATE TABLE provider_connections (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('proton')),
        host TEXT NOT NULL CHECK (host IN ('127.0.0.1', '::1', 'localhost')),
        port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
        username TEXT NOT NULL,
        security TEXT NOT NULL CHECK (security IN ('starttls', 'tls', 'plain')),
        secret_ref_id TEXT NOT NULL REFERENCES secret_refs(id) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK (state IN ('connected', 'attention')),
        last_connected_at TEXT,
        last_error_category TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(profile_id, provider)
      );

      CREATE INDEX provider_connections_profile_idx
        ON provider_connections(profile_id, provider);
    `,
  },
  {
    version: 3,
    statements: `
      CREATE TABLE proton_capabilities (
        connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
        capability TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY(connection_id, capability)
      );

      CREATE TABLE mail_containers (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        provider_container_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        delimiter TEXT NOT NULL,
        special_use TEXT,
        flags_json TEXT NOT NULL DEFAULT '[]',
        message_count INTEGER NOT NULL CHECK(message_count >= 0),
        unread_count INTEGER NOT NULL CHECK(unread_count >= 0),
        uid_validity TEXT NOT NULL,
        uid_next INTEGER NOT NULL CHECK(uid_next >= 0),
        observed_at TEXT NOT NULL,
        UNIQUE(connection_id, provider_container_id)
      );

      CREATE TABLE receiving_addresses (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        normalized_address TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL CHECK(occurrence_count > 0),
        last_seen_at TEXT,
        sources_json TEXT NOT NULL DEFAULT '[]',
        observed_at TEXT NOT NULL,
        UNIQUE(connection_id, normalized_address)
      );

      CREATE INDEX mail_containers_profile_idx ON mail_containers(profile_id, connection_id);
      CREATE INDEX receiving_addresses_profile_idx ON receiving_addresses(profile_id, connection_id);
    `,
  },
  {
    version: 4,
    statements: `
      CREATE TABLE proton_audit_runs (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
        extract_bodies INTEGER NOT NULL CHECK(extract_bodies IN (0, 1)),
        created_at TEXT NOT NULL
      );

      CREATE TABLE proton_folder_checkpoints (
        connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
        container_id TEXT NOT NULL REFERENCES mail_containers(id) ON DELETE CASCADE,
        uid_validity TEXT NOT NULL,
        last_uid INTEGER NOT NULL DEFAULT 0 CHECK(last_uid >= 0),
        indexed_count INTEGER NOT NULL DEFAULT 0 CHECK(indexed_count >= 0),
        earliest_at TEXT,
        latest_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(connection_id, container_id)
      );

      CREATE TABLE indexed_messages (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
        container_id TEXT NOT NULL REFERENCES mail_containers(id) ON DELETE CASCADE,
        uid_validity TEXT NOT NULL,
        uid INTEGER NOT NULL CHECK(uid > 0),
        message_id TEXT,
        received_at TEXT,
        subject TEXT,
        sender_json TEXT NOT NULL DEFAULT '[]',
        recipients_json TEXT NOT NULL DEFAULT '[]',
        headers_json TEXT NOT NULL DEFAULT '{}',
        flags_json TEXT NOT NULL DEFAULT '[]',
        size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
        body_text TEXT,
        body_truncated INTEGER NOT NULL DEFAULT 0 CHECK(body_truncated IN (0, 1)),
        indexed_at TEXT NOT NULL,
        UNIQUE(connection_id, container_id, uid_validity, uid)
      );

      CREATE TABLE proton_scan_failures (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        container_id TEXT REFERENCES mail_containers(id) ON DELETE CASCADE,
        uid INTEGER,
        category TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX indexed_messages_connection_idx ON indexed_messages(connection_id, container_id, uid);
      CREATE INDEX proton_scan_failures_job_idx ON proton_scan_failures(job_id, container_id);
    `,
  },
  {
    version: 5,
    statements: `
      CREATE TABLE mailbox_analyses (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        classifier_version TEXT NOT NULL,
        analyzed_at TEXT NOT NULL
      );

      CREATE TABLE message_classifications (
        analysis_id TEXT NOT NULL REFERENCES mailbox_analyses(id) ON DELETE CASCADE,
        message_row_id TEXT NOT NULL REFERENCES indexed_messages(id) ON DELETE CASCADE,
        canonical_key TEXT NOT NULL,
        category TEXT NOT NULL,
        confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
        evidence_json TEXT NOT NULL,
        sender_domain TEXT NOT NULL,
        receiving_addresses_json TEXT NOT NULL,
        PRIMARY KEY(analysis_id, canonical_key)
      );

      CREATE TABLE analysis_streams (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL REFERENCES mailbox_analyses(id) ON DELETE CASCADE,
        sender_domain TEXT NOT NULL,
        category TEXT NOT NULL,
        receiving_address TEXT NOT NULL,
        message_count INTEGER NOT NULL CHECK(message_count > 0),
        latest_at TEXT,
        confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
        evidence_json TEXT NOT NULL
      );

      CREATE TABLE address_service_evidence (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL REFERENCES mailbox_analyses(id) ON DELETE CASCADE,
        receiving_address TEXT NOT NULL,
        sender_domain TEXT NOT NULL,
        message_count INTEGER NOT NULL CHECK(message_count > 0),
        latest_at TEXT,
        categories_json TEXT NOT NULL
      );

      CREATE INDEX message_classifications_analysis_idx ON message_classifications(analysis_id, category);
      CREATE INDEX analysis_streams_analysis_idx ON analysis_streams(analysis_id, message_count DESC);
      CREATE INDEX address_service_analysis_idx ON address_service_evidence(analysis_id, receiving_address);
    `,
  },
  {
    version: 6,
    statements: `
      CREATE TABLE cleanup_plans (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
        analysis_id TEXT NOT NULL REFERENCES mailbox_analyses(id) ON DELETE CASCADE,
        revision TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('draft', 'approved', 'executing', 'completed', 'failed')),
        skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count >= 0),
        job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        approved_at TEXT
      );

      CREATE TABLE cleanup_actions (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES cleanup_plans(id) ON DELETE CASCADE,
        message_row_id TEXT NOT NULL REFERENCES indexed_messages(id) ON DELETE CASCADE,
        canonical_key TEXT NOT NULL,
        category TEXT NOT NULL,
        source_path TEXT NOT NULL,
        uid_validity TEXT NOT NULL,
        uid INTEGER NOT NULL CHECK(uid > 0),
        target_path TEXT NOT NULL,
        action_kind TEXT NOT NULL CHECK(action_kind IN ('sort_read_archive', 'native_spam')),
        state TEXT NOT NULL CHECK(state IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'verification_mismatch')),
        prior_flags_json TEXT,
        error_code TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(plan_id, canonical_key)
      );

      CREATE INDEX cleanup_actions_plan_state_idx ON cleanup_actions(plan_id, state);
    `,
  },
  {
    version: 7,
    statements: `
      CREATE TABLE subscription_scans (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL REFERENCES mailbox_analyses(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        generated_at TEXT NOT NULL
      );

      CREATE TABLE subscription_candidates (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL REFERENCES subscription_scans(id) ON DELETE CASCADE,
        sender_domain TEXT NOT NULL,
        list_id TEXT NOT NULL,
        receiving_address TEXT NOT NULL,
        endpoint TEXT,
        eligibility TEXT NOT NULL CHECK(eligibility IN ('eligible', 'manual', 'protected', 'spam_skipped')),
        authenticated INTEGER NOT NULL CHECK(authenticated IN (0, 1)),
        message_count INTEGER NOT NULL CHECK(message_count > 0),
        latest_at TEXT,
        categories_json TEXT NOT NULL,
        sample_subjects_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'unsubscribed', 'failed', 'manual', 'spam_skipped')),
        reason TEXT NOT NULL
      );

      CREATE TABLE unsubscribe_runs (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        scan_id TEXT NOT NULL REFERENCES subscription_scans(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );

      CREATE INDEX subscription_candidates_scan_idx ON subscription_candidates(scan_id, eligibility, message_count DESC);
    `,
  },
  {
    version: 8,
    statements: `
      CREATE TABLE gmail_connections (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        client_id TEXT NOT NULL,
        secret_ref_id TEXT NOT NULL REFERENCES secret_refs(id) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK(state IN ('connected', 'attention')),
        connected_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX gmail_connections_profile_idx ON gmail_connections(profile_id);
    `,
  },
  {
    version: 9,
    statements: `
      CREATE TABLE gmail_audit_state (
        connection_id TEXT PRIMARY KEY REFERENCES gmail_connections(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK(state IN ('idle', 'scanning', 'paused', 'completed', 'failed')),
        next_page_token TEXT,
        indexed_messages INTEGER NOT NULL DEFAULT 0 CHECK(indexed_messages >= 0),
        total_estimate INTEGER NOT NULL DEFAULT 0 CHECK(total_estimate >= 0),
        earliest_at TEXT,
        latest_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE gmail_indexed_messages (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES gmail_connections(id) ON DELETE CASCADE,
        gmail_message_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        received_at TEXT,
        subject TEXT,
        sender_json TEXT NOT NULL DEFAULT '[]',
        recipients_json TEXT NOT NULL DEFAULT '[]',
        headers_json TEXT NOT NULL DEFAULT '{}',
        label_ids_json TEXT NOT NULL DEFAULT '[]',
        size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
        indexed_at TEXT NOT NULL,
        UNIQUE(connection_id, gmail_message_id)
      );
      CREATE INDEX gmail_messages_connection_date_idx ON gmail_indexed_messages(connection_id, received_at DESC);
    `,
  },
  {
    version: 10,
    statements: `
      CREATE TABLE gmail_mailbox_analyses (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL UNIQUE REFERENCES gmail_connections(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        classifier_version TEXT NOT NULL,
        analyzed_at TEXT NOT NULL
      );
      CREATE TABLE gmail_message_classifications (
        analysis_id TEXT NOT NULL REFERENCES gmail_mailbox_analyses(id) ON DELETE CASCADE,
        message_row_id TEXT NOT NULL REFERENCES gmail_indexed_messages(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
        evidence_json TEXT NOT NULL,
        sender_domain TEXT NOT NULL,
        receiving_addresses_json TEXT NOT NULL,
        PRIMARY KEY(analysis_id, message_row_id)
      );
      CREATE TABLE gmail_analysis_streams (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL REFERENCES gmail_mailbox_analyses(id) ON DELETE CASCADE,
        sender_domain TEXT NOT NULL,
        category TEXT NOT NULL,
        receiving_address TEXT NOT NULL,
        message_count INTEGER NOT NULL CHECK(message_count > 0),
        latest_at TEXT,
        confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
        evidence_json TEXT NOT NULL
      );
      CREATE INDEX gmail_classifications_analysis_idx ON gmail_message_classifications(analysis_id, category);
      CREATE INDEX gmail_streams_analysis_idx ON gmail_analysis_streams(analysis_id, message_count DESC);
    `,
  },
  {
    version: 11,
    statements: `
      CREATE TABLE gmail_organization_plans (
        id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES gmail_connections(id) ON DELETE CASCADE,
        analysis_id TEXT NOT NULL REFERENCES gmail_mailbox_analyses(id) ON DELETE CASCADE, revision TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('draft','approved','running','completed','failed')),
        skipped_ambiguous_streams INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, approved_at TEXT
      );
      CREATE TABLE gmail_rule_actions (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES gmail_organization_plans(id) ON DELETE CASCADE,
        rule_key TEXT NOT NULL, sender_domain TEXT NOT NULL, receiving_address TEXT, category TEXT NOT NULL,
        target_label TEXT NOT NULL, mark_read INTEGER NOT NULL CHECK(mark_read IN (0,1)), archive INTEGER NOT NULL CHECK(archive IN (0,1)), spam INTEGER NOT NULL CHECK(spam IN (0,1)),
        confidence REAL NOT NULL, existing_messages INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL CHECK(state IN ('pending','running','succeeded','failed')),
        filter_id TEXT, error_code TEXT, updated_at TEXT NOT NULL, UNIQUE(plan_id,rule_key)
      );
      CREATE INDEX gmail_rules_plan_state_idx ON gmail_rule_actions(plan_id,state);
    `,
  },
  {
    version: 12,
    statements: `
      CREATE TABLE gmail_subscription_scans (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES gmail_mailbox_analyses(id) ON DELETE CASCADE, profile_id TEXT NOT NULL, generated_at TEXT NOT NULL);
      CREATE TABLE gmail_subscription_candidates (
        id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES gmail_subscription_scans(id) ON DELETE CASCADE,
        sender_domain TEXT NOT NULL, list_id TEXT NOT NULL, receiving_address TEXT NOT NULL, endpoint TEXT,
        eligibility TEXT NOT NULL CHECK(eligibility IN ('eligible','manual','protected','spam_skipped')),
        authenticated INTEGER NOT NULL CHECK(authenticated IN (0,1)), message_count INTEGER NOT NULL,
        latest_at TEXT, categories_json TEXT NOT NULL, sample_subjects_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','unsubscribed','failed','manual','spam_skipped')), reason TEXT NOT NULL
      );
      CREATE INDEX gmail_subscription_candidates_scan_idx ON gmail_subscription_candidates(scan_id,eligibility,message_count DESC);
    `,
  },
  {
    version: 13,
    statements: `
      ALTER TABLE cleanup_plans ADD COLUMN plan_kind TEXT NOT NULL DEFAULT 'organize'
        CHECK(plan_kind IN ('organize','trash'));

      ALTER TABLE cleanup_actions RENAME TO cleanup_actions_v12;
      DROP INDEX cleanup_actions_plan_state_idx;
      CREATE TABLE cleanup_actions (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES cleanup_plans(id) ON DELETE CASCADE,
        message_row_id TEXT NOT NULL REFERENCES indexed_messages(id) ON DELETE CASCADE,
        canonical_key TEXT NOT NULL,
        category TEXT NOT NULL,
        source_path TEXT NOT NULL,
        uid_validity TEXT NOT NULL,
        uid INTEGER NOT NULL CHECK(uid > 0),
        target_path TEXT NOT NULL,
        action_kind TEXT NOT NULL CHECK(action_kind IN ('sort_read_archive', 'native_spam', 'native_trash')),
        state TEXT NOT NULL CHECK(state IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'verification_mismatch')),
        prior_flags_json TEXT,
        error_code TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(plan_id, canonical_key)
      );
      INSERT INTO cleanup_actions SELECT * FROM cleanup_actions_v12;
      DROP TABLE cleanup_actions_v12;
      CREATE INDEX cleanup_actions_plan_state_idx ON cleanup_actions(plan_id, state);
    `,
  },
  {
    version: 14,
    foreignKeysOff: true,
    statements: `
      PRAGMA legacy_alter_table = ON;

      DROP INDEX provider_connections_profile_idx;
      ALTER TABLE provider_connections RENAME TO provider_connections_v13;
      CREATE TABLE provider_connections (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('proton')),
        host TEXT NOT NULL CHECK (host IN ('127.0.0.1', '::1', 'localhost')),
        port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
        username TEXT NOT NULL,
        security TEXT NOT NULL CHECK (security IN ('starttls', 'tls', 'plain')),
        secret_ref_id TEXT NOT NULL REFERENCES secret_refs(id) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK (state IN ('connected', 'attention')),
        last_connected_at TEXT,
        last_error_category TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO provider_connections SELECT * FROM provider_connections_v13;
      DROP TABLE provider_connections_v13;
      CREATE INDEX provider_connections_profile_idx ON provider_connections(profile_id, provider);
      CREATE UNIQUE INDEX provider_connections_identity_idx
        ON provider_connections(profile_id, provider, host, port, username);

      DROP INDEX gmail_connections_profile_idx;
      ALTER TABLE gmail_connections RENAME TO gmail_connections_v13;
      CREATE TABLE gmail_connections (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        email TEXT NOT NULL,
        client_id TEXT NOT NULL,
        secret_ref_id TEXT NOT NULL REFERENCES secret_refs(id) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK(state IN ('connected', 'attention')),
        connected_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO gmail_connections SELECT * FROM gmail_connections_v13;
      DROP TABLE gmail_connections_v13;
      CREATE INDEX gmail_connections_profile_idx ON gmail_connections(profile_id);
      CREATE UNIQUE INDEX gmail_connections_identity_idx ON gmail_connections(profile_id, email);

      CREATE TABLE account_selections (
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('proton', 'gmail')),
        connection_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(profile_id, provider)
      );

      INSERT INTO account_selections(profile_id, provider, connection_id, updated_at)
      SELECT profile_id, 'proton', id, updated_at FROM provider_connections;
      INSERT INTO account_selections(profile_id, provider, connection_id, updated_at)
      SELECT profile_id, 'gmail', id, updated_at FROM gmail_connections;

      CREATE TABLE account_identities (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('proton', 'gmail')),
        connection_id TEXT NOT NULL,
        normalized_address TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '[]',
        sent_from_count INTEGER NOT NULL DEFAULT 0 CHECK(sent_from_count >= 0),
        delivered_to_count INTEGER NOT NULL DEFAULT 0 CHECK(delivered_to_count >= 0),
        provider_evidence INTEGER NOT NULL DEFAULT 0 CHECK(provider_evidence IN (0, 1)),
        last_seen_at TEXT,
        user_status TEXT NOT NULL DEFAULT 'unreviewed'
          CHECK(user_status IN ('unreviewed', 'confirmed', 'rejected')),
        container_enabled INTEGER NOT NULL DEFAULT 0 CHECK(container_enabled IN (0, 1)),
        container_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connection_id, normalized_address)
      );
      CREATE INDEX account_identities_profile_connection_idx
        ON account_identities(profile_id, provider, connection_id, user_status);

      PRAGMA legacy_alter_table = OFF;
    `,
  },
  {
    version: 15,
    statements: `
      CREATE TABLE organization_proposals (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('proton', 'gmail')),
        connection_id TEXT NOT NULL,
        analysis_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft', 'approved', 'superseded')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX organization_proposals_scope_idx
        ON organization_proposals(profile_id, provider, connection_id, updated_at DESC);

      CREATE TABLE organization_proposal_items (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL REFERENCES organization_proposals(id) ON DELETE CASCADE,
        scope_address TEXT,
        container_name TEXT,
        category TEXT NOT NULL,
        target_path TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        message_count INTEGER NOT NULL CHECK(message_count > 0),
        latest_at TEXT,
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        evidence_json TEXT NOT NULL,
        samples_json TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX organization_proposal_items_plan_idx
        ON organization_proposal_items(proposal_id, scope_address, message_count DESC);

      CREATE TABLE organization_corrections (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL REFERENCES organization_proposals(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES organization_proposal_items(id) ON DELETE CASCADE,
        prior_json TEXT NOT NULL,
        corrected_json TEXT NOT NULL,
        resulting_revision TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 16,
    statements: `
      ALTER TABLE organization_proposal_items ADD COLUMN source_category TEXT;
      UPDATE organization_proposal_items SET source_category = category WHERE source_category IS NULL;

      CREATE TABLE rule_inventories (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('proton', 'gmail')),
        connection_id TEXT NOT NULL,
        capability TEXT NOT NULL CHECK(capability IN ('live_api', 'managed_export')),
        provider_limit INTEGER,
        captured_at TEXT NOT NULL
      );
      CREATE INDEX rule_inventories_scope_idx
        ON rule_inventories(profile_id, provider, connection_id, captured_at DESC);

      CREATE TABLE rule_inventory_items (
        id TEXT PRIMARY KEY,
        inventory_id TEXT NOT NULL REFERENCES rule_inventories(id) ON DELETE CASCADE,
        provider_rule_id TEXT NOT NULL,
        stable_key TEXT,
        fingerprint TEXT NOT NULL,
        ownership TEXT NOT NULL CHECK(ownership IN ('external', 'managed', 'adopted', 'exported')),
        criteria_json TEXT NOT NULL,
        action_json TEXT NOT NULL
      );
      CREATE INDEX rule_inventory_items_snapshot_idx
        ON rule_inventory_items(inventory_id, ownership, fingerprint);

      CREATE TABLE managed_rules (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('proton', 'gmail')),
        connection_id TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        provider_rule_id TEXT,
        fingerprint TEXT NOT NULL,
        desired_json TEXT NOT NULL,
        ownership TEXT NOT NULL CHECK(ownership IN ('managed', 'adopted', 'exported')),
        state TEXT NOT NULL CHECK(state IN ('active', 'removed', 'mismatched')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connection_id, stable_key)
      );
      CREATE INDEX managed_rules_scope_idx
        ON managed_rules(profile_id, provider, connection_id, state);

      CREATE TABLE rule_reconciliation_plans (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('proton', 'gmail')),
        connection_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL REFERENCES organization_proposals(id) ON DELETE CASCADE,
        proposal_revision TEXT NOT NULL,
        inventory_id TEXT NOT NULL REFERENCES rule_inventories(id) ON DELETE RESTRICT,
        revision TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('draft', 'approved', 'executing', 'completed', 'failed', 'undone')),
        job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        undo_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        approved_at TEXT
      );
      CREATE INDEX rule_reconciliation_plans_scope_idx
        ON rule_reconciliation_plans(profile_id, provider, connection_id, created_at DESC);

      CREATE TABLE rule_reconciliation_operations (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES rule_reconciliation_plans(id) ON DELETE CASCADE,
        stable_key TEXT NOT NULL,
        operation_kind TEXT NOT NULL CHECK(operation_kind IN ('create', 'replace', 'remove', 'adopt', 'unchanged')),
        desired_json TEXT,
        prior_json TEXT,
        prior_managed_json TEXT,
        state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'running', 'succeeded', 'failed', 'verification_mismatch', 'undone')),
        provider_rule_id TEXT,
        verified_fingerprint TEXT,
        error_code TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(plan_id, stable_key)
      );
      CREATE INDEX rule_reconciliation_operations_state_idx
        ON rule_reconciliation_operations(plan_id, state, operation_kind);

      CREATE TABLE proton_rule_exports (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        plan_id TEXT NOT NULL REFERENCES rule_reconciliation_plans(id) ON DELETE CASCADE,
        revision TEXT NOT NULL,
        checksum TEXT NOT NULL,
        exported_path TEXT,
        exported_at TEXT,
        import_status TEXT NOT NULL CHECK(import_status IN ('not_exported', 'awaiting_manual_import', 'confirmed_imported')),
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 17,
    statements: `
      ALTER TABLE cleanup_plans ADD COLUMN undo_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL;
      ALTER TABLE cleanup_actions ADD COLUMN resulting_path TEXT;
      ALTER TABLE cleanup_actions ADD COLUMN resulting_uid_validity TEXT;
      ALTER TABLE cleanup_actions ADD COLUMN resulting_uid INTEGER;
      ALTER TABLE cleanup_actions ADD COLUMN resulting_flags_json TEXT;
      ALTER TABLE cleanup_actions ADD COLUMN undo_state TEXT CHECK(undo_state IN ('pending', 'running', 'succeeded', 'failed', 'verification_mismatch'));
      ALTER TABLE cleanup_actions ADD COLUMN undo_error_code TEXT;
    `,
  },
  {
    version: 18,
    statements: `
      ALTER TABLE gmail_organization_plans ADD COLUMN proposal_id TEXT REFERENCES organization_proposals(id) ON DELETE CASCADE;
      ALTER TABLE gmail_organization_plans ADD COLUMN proposal_revision TEXT;
      ALTER TABLE gmail_organization_plans ADD COLUMN job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL;
      ALTER TABLE gmail_organization_plans ADD COLUMN undo_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL;

      CREATE TABLE gmail_history_impacts (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES gmail_organization_plans(id) ON DELETE CASCADE,
        scope_address TEXT,
        source_category TEXT NOT NULL,
        category TEXT NOT NULL,
        target_label TEXT NOT NULL,
        mark_read INTEGER NOT NULL CHECK(mark_read IN (0,1)),
        archive INTEGER NOT NULL CHECK(archive IN (0,1)),
        spam INTEGER NOT NULL CHECK(spam IN (0,1)),
        confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
        existing_messages INTEGER NOT NULL CHECK(existing_messages > 0)
      );

      CREATE TABLE gmail_history_batches (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES gmail_organization_plans(id) ON DELETE CASCADE,
        impact_id TEXT NOT NULL REFERENCES gmail_history_impacts(id) ON DELETE CASCADE,
        message_ids_json TEXT NOT NULL,
        prior_labels_json TEXT NOT NULL,
        resulting_labels_json TEXT,
        state TEXT NOT NULL CHECK(state IN ('pending','running','succeeded','failed','verification_mismatch')),
        error_code TEXT,
        undo_state TEXT CHECK(undo_state IN ('pending','running','succeeded','failed','verification_mismatch')),
        undo_error_code TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX gmail_history_batches_plan_state_idx ON gmail_history_batches(plan_id,state);
    `,
  },
  {
    version: 19,
    statements: `
      ALTER TABLE cleanup_plans ADD COLUMN proposal_id TEXT REFERENCES organization_proposals(id) ON DELETE CASCADE;
      ALTER TABLE cleanup_plans ADD COLUMN proposal_revision TEXT;
    `,
  },
]);

export const applyMigrations = (
  database: BetterSqlite3.Database,
  now: () => string = () => new Date().toISOString(),
  throughVersion = Number.POSITIVE_INFINITY,
): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => (row as { version: number }).version),
  );
  const record = database.prepare(
    'INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (migration.version > throughVersion) continue;
    if (applied.has(migration.version)) continue;
    const apply = database.transaction(() => {
        database.exec(migration.statements);
        record.run(migration.version, now());
      });
    if (!migration.foreignKeysOff) {
      apply();
      continue;
    }
    database.pragma('foreign_keys = OFF');
    try {
      apply();
    } finally {
      database.pragma('legacy_alter_table = OFF');
      database.pragma('foreign_keys = ON');
    }
    const violations = database.pragma('foreign_key_check') as unknown[];
    if (violations.length) {
      throw new Error(`Migration ${migration.version} left ${violations.length} foreign-key violation(s)`);
    }
  }
};
