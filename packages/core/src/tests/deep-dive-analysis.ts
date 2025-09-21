/**
 * Deep dive analysis: Understanding TypeScript's inference behavior
 */

// Test 1: Simple object literal - what does TypeScript infer?
const simpleObject = {
  data: { name: 'John', age: 30 },
  callback: ({ data }: { data: any }) => {
    // Even with explicit typing, we need to specify the type
  }
};

// Test 2: What happens with generic functions?
function simpleGeneric<T>(obj: T): T {
  return obj;
}

const result1 = simpleGeneric({
  data: { name: 'John', age: 30 },
  callback: ({ data }) => {
    // What type is data here?
    // Answer: any, because TypeScript can't infer the relationship
  }
});

// Test 3: Can we make a type that relates these properties?
type StepWithTypedCallback<TData> = {
  data: TData;
  callback: (args: { data: TData }) => void;
};

// This works but requires explicit typing:
const explicitlyTyped: StepWithTypedCallback<{ name: string; age: number }> = {
  data: { name: 'John', age: 30 },
  callback: ({ data }) => {
    // data is properly typed here!
    const name: string = data.name;
    const age: number = data.age;
  }
};

// Test 4: Can we infer this automatically?
function inferredTyping<T>(config: {
  data: T;
  callback: (args: { data: T }) => void;
}): typeof config {
  return config;
}

const result2 = inferredTyping({
  data: { name: 'John', age: 30 },
  callback: ({ data }) => {
    // What type is data here?
    const name: string = data.name; // This should work!
    const age: number = data.age;
  }
});

// Test 5: What about with conditional types?
type ExtractDataType<T> = T extends { data: infer D } ? D : never;

function conditionalTyping<T extends { data: any }>(
  config: T & {
    callback: (args: { data: ExtractDataType<T> }) => void;
  }
): typeof config {
  return config;
}

const result3 = conditionalTyping({
  data: { name: 'John', age: 30 },
  callback: ({ data }) => {
    // Does this work?
    const name: string = data.name;
    const age: number = data.age;
  }
});

export { result1, result2, result3 };