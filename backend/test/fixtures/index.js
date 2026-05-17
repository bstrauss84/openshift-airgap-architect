/**
 * Test fixtures - shared state objects and builders
 *
 * Consolidates 84+ duplicate fixture definitions from 21 test files.
 * Reduces duplication and provides consistent, maintainable test data.
 *
 * Usage:
 *   import { baseStates, builders } from './fixtures/index.js';
 *
 *   const state = baseStates.bareMetalAgent();
 *   const fipsState = builders.withFips(baseStates.vsphereIpi());
 *   const complexState = builders.withProxy(
 *     builders.withDualStack(
 *       builders.withFips(baseStates.bareMetalAgent())
 *     )
 *   );
 */

export * as baseStates from './base-states.js';
export * as builders from './builders.js';
