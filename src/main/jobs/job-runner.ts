import type { JobProgress } from '../../core/jobs/job-types';
import { JobRepository } from './job-repository';

export type JobProgressListener = (progress: JobProgress) => void;

export class JobRunner {
  readonly #repository: JobRepository;
  readonly #delay: () => Promise<void>;
  readonly #listeners = new Set<JobProgressListener>();

  constructor(
    repository: JobRepository,
    options: { delay?: () => Promise<void> } = {},
  ) {
    this.#repository = repository;
    this.#delay = options.delay ?? (() => new Promise((resolve) => setTimeout(resolve, 35)));
  }

  subscribe(listener: JobProgressListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async run(jobId: string): Promise<JobProgress> {
    this.#emit(this.#repository.getProgress(jobId));
    for (;;) {
      const item = this.#repository.claimNextPending(jobId);
      if (!item) break;
      this.#emit(this.#repository.getProgress(jobId));
      await this.#delay();
      this.#repository.transitionItem(item.id, 'succeeded', {
        result: { operation: 'synthetic-check', verified: true },
      });
      this.#emit(this.#repository.getProgress(jobId));
    }
    const progress = this.#repository.getProgress(jobId);
    this.#emit(progress);
    return progress;
  }

  #emit(progress: JobProgress): void {
    for (const listener of this.#listeners) listener(progress);
  }
}
