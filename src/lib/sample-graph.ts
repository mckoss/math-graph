/**
 * A small hand-built ConceptGraph used by tests and dev experiments.
 * The real app data comes from src/data/curriculum.dsl via the DSL parser.
 */

import type { ConceptGraph } from './types';

export const sampleGraph: ConceptGraph = {
  nodes: [
    // -- Arithmetic ----------------------------------------------------------
    {
      id: 'arithmetic',
      label: 'Arithmetic',
      wikipedia: 'Arithmetic',
      description: 'The art of working with numbers: counting, combining, and comparing quantities.',
      isCategory: true,
    },
    {
      id: 'counting',
      label: 'Counting',
      wikipedia: 'Counting',
      description: 'Assigning numbers to collections of things, one by one.',
      parent: 'arithmetic',
      isCategory: false,
      stage: 'elementary',
    },
    {
      id: 'addition',
      label: 'Addition',
      wikipedia: 'Addition',
      description: 'Combining two quantities into a total.',
      parent: 'arithmetic',
      isCategory: false,
      stage: 'elementary',
    },
    {
      id: 'multiplication',
      label: 'Multiplication',
      wikipedia: 'Multiplication',
      description: 'Repeated addition; scaling one quantity by another.',
      parent: 'arithmetic',
      isCategory: false,
      stage: 'elementary',
    },
    {
      id: 'fractions',
      label: 'Fractions',
      wikipedia: 'Fraction',
      description: 'Parts of a whole, written as one integer over another.',
      parent: 'arithmetic',
      isCategory: false,
      stage: 'elementary',
    },
    // -- Algebra -------------------------------------------------------------
    {
      id: 'algebra',
      label: 'Algebra',
      wikipedia: 'Algebra',
      description: 'Reasoning about unknown quantities with symbols and equations.',
      isCategory: true,
    },
    {
      id: 'variables',
      label: 'Variables',
      wikipedia: 'Variable_(mathematics)',
      description: 'Letters that stand in for unknown or changing numbers.',
      parent: 'algebra',
      isCategory: false,
      stage: 'middle',
    },
    {
      id: 'linear-equations',
      label: 'Linear Equations',
      wikipedia: 'Linear_equation',
      description: 'Equations whose graphs are straight lines.',
      parent: 'algebra',
      isCategory: false,
      stage: 'middle',
    },
    {
      id: 'quadratic-equations',
      label: 'Quadratic Equations',
      wikipedia: 'Quadratic_equation',
      description: 'Equations involving a squared unknown.',
      parent: 'algebra',
      isCategory: false,
      stage: 'high-school',
    },
    // -- Geometry ------------------------------------------------------------
    {
      id: 'geometry',
      label: 'Geometry',
      wikipedia: 'Geometry',
      description: 'The study of shape, size, and space.',
      isCategory: true,
    },
    {
      id: 'shapes',
      label: 'Basic Shapes',
      wikipedia: 'Shape',
      description: 'Triangles, circles, squares, and their properties.',
      parent: 'geometry',
      isCategory: false,
      stage: 'elementary',
    },
    {
      id: 'pythagorean-theorem',
      label: 'Pythagorean Theorem',
      wikipedia: 'Pythagorean_theorem',
      description: 'Relates the sides of a right triangle: a² + b² = c².',
      parent: 'geometry',
      isCategory: false,
      stage: 'middle',
    },
    {
      id: 'trigonometry',
      label: 'Trigonometry',
      wikipedia: 'Trigonometry',
      description: 'Ratios of triangle sides as functions of angles.',
      parent: 'geometry',
      isCategory: false,
      stage: 'high-school',
    },
    // -- Top-level (no parent) ----------------------------------------------
    {
      id: 'functions',
      label: 'Functions',
      wikipedia: 'Function_(mathematics)',
      description: 'Rules that assign each input exactly one output.',
      isCategory: false,
      stage: 'high-school',
    },
  ],
  edges: [
    { from: 'counting', to: 'addition' },
    { from: 'addition', to: 'multiplication' },
    { from: 'multiplication', to: 'fractions' },
    { from: 'fractions', to: 'variables' },
    { from: 'variables', to: 'linear-equations' },
    { from: 'linear-equations', to: 'quadratic-equations' },
    { from: 'counting', to: 'shapes' },
    { from: 'shapes', to: 'pythagorean-theorem' },
    { from: 'multiplication', to: 'pythagorean-theorem' },
    { from: 'pythagorean-theorem', to: 'trigonometry' },
    { from: 'variables', to: 'functions' },
    { from: 'functions', to: 'trigonometry' },
    { from: 'functions', to: 'quadratic-equations' },
  ],
};
