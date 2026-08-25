import type { RuleInventory } from '../../shared/contracts/rule-management';
import type { RuleReconciliationRepository } from './rule-reconciliation-repository';

export class ProtonRuleInventoryService {
  readonly #rules: RuleReconciliationRepository;

  constructor(rules: RuleReconciliationRepository) {
    this.#rules = rules;
  }

  refresh(connectionId: string): RuleInventory {
    return this.#rules.saveInventory(
      'proton',
      connectionId,
      'managed_export',
      this.#rules.managedExportSnapshots(connectionId),
      null,
    );
  }
}
