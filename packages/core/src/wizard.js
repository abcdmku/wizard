import { Store } from '@tanstack/store';
/**
 * Creates a deeply type-safe wizard instance
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template D - Per-step data map
 * @template E - Event types
 */
export function createWizard(config) {
    const { initialStep, initialContext, steps, onTransition, persistence, keepHistory = true, maxHistorySize = 10, } = config;
    // Event listeners
    const eventListeners = new Set();
    // Initialize state
    const initialState = {
        step: initialStep,
        context: structuredClone(initialContext),
        data: {},
        errors: {},
        history: [],
        isLoading: false,
        isTransitioning: false,
    };
    // Create reactive store
    const store = new Store(initialState);
    // Load persisted state if available
    if (persistence?.load) {
        Promise.resolve(persistence.load()).then((savedState) => {
            if (savedState) {
                store.setState(() => savedState);
            }
        });
    }
    // Helper to save state
    const saveState = () => {
        if (persistence?.save) {
            const state = store.state;
            Promise.resolve(persistence.save(state));
        }
    };
    // Helper to update state and save
    const updateState = (updater) => {
        store.setState(updater);
        saveState();
    };
    // Helper to clone context for safe mutation
    const cloneContext = (ctx) => {
        return structuredClone(ctx);
    };
    // Update context with mutable draft pattern
    const updateContext = (updater) => {
        updateState((state) => {
            const draft = cloneContext(state.context);
            updater(draft);
            return {
                ...state,
                context: draft,
            };
        });
    };
    // Set data for a specific step
    const setStepData = (step, data) => {
        updateState((state) => {
            const newData = {
                ...state.data,
                [step]: data,
            };
            const newErrors = state.errors[step]
                ? { ...state.errors, [step]: undefined }
                : state.errors;
            return {
                ...state,
                data: newData,
                errors: newErrors,
            };
        });
    };
    // Get current context (readonly)
    const getContext = () => {
        return store.state.context;
    };
    // Get current step info
    const getCurrent = () => {
        const state = store.state;
        return {
            step: state.step,
            data: state.data[state.step],
            ctx: state.context,
        };
    };
    // Emit custom event
    const emit = (event) => {
        eventListeners.forEach((listener) => listener(event));
    };
    // Add to history
    const pushHistory = () => {
        if (!keepHistory)
            return;
        updateState((state) => {
            const historyEntry = {
                step: state.step,
                context: cloneContext(state.context),
                data: structuredClone(state.data),
            };
            return {
                ...state,
                history: [
                    ...state.history.slice(-(maxHistorySize - 1)),
                    historyEntry,
                ],
            };
        });
    };
    // Validate step data
    const validateStepData = async (step, data) => {
        const stepDef = steps[step];
        if (!stepDef.validate) {
            return { valid: true };
        }
        try {
            const validator = stepDef.validate;
            validator(data, getContext());
            return { valid: true };
        }
        catch (error) {
            return { valid: false, error };
        }
    };
    // Check if can enter step
    const canEnterStep = async (step) => {
        const stepDef = steps[step];
        if (!stepDef.canEnter) {
            return true;
        }
        const result = await stepDef.canEnter({ ctx: getContext() });
        return result;
    };
    // Check if can exit current step
    const canExitStep = async () => {
        const state = store.state;
        const stepDef = steps[state.step];
        if (!stepDef.canExit) {
            return true;
        }
        const data = state.data[state.step] || {};
        const result = await stepDef.canExit({
            ctx: getContext(),
            data: data
        });
        return result;
    };
    // Execute beforeExit hook
    const executeBeforeExit = async () => {
        const state = store.state;
        const stepDef = steps[state.step];
        if (!stepDef.beforeExit) {
            return;
        }
        const data = state.data[state.step] || {};
        await stepDef.beforeExit({
            ctx: getContext(),
            data: data,
            updateContext,
            emit,
        });
    };
    // Execute load hook
    const executeLoad = async (step) => {
        const stepDef = steps[step];
        if (!stepDef.load) {
            return;
        }
        updateState((state) => ({
            ...state,
            isLoading: true,
        }));
        try {
            await stepDef.load({
                ctx: getContext(),
                setStepData: (data) => setStepData(step, data),
                updateContext,
            });
        }
        finally {
            updateState((state) => ({
                ...state,
                isLoading: false,
            }));
        }
    };
    // Get allowed next steps
    const getNextSteps = () => {
        const state = store.state;
        const stepDef = steps[state.step];
        const data = state.data[state.step] || {};
        if (typeof stepDef.next === 'function') {
            const result = stepDef.next({
                ctx: getContext(),
                data: data
            });
            return Array.isArray(result) ? [...result] : [result];
        }
        return [...stepDef.next];
    };
    // Transition to a new step
    const transitionTo = async (targetStep, data, transitionType = 'goto') => {
        const currentState = store.state;
        const fromStep = currentState.step;
        // Set transitioning flag
        updateState((state) => ({
            ...state,
            isTransitioning: true,
        }));
        try {
            // If data provided, validate and set it
            if (data !== undefined) {
                const validation = await validateStepData(fromStep, data);
                if (!validation.valid) {
                    updateState((state) => ({
                        ...state,
                        errors: {
                            ...state.errors,
                            [fromStep]: validation.error,
                        },
                        isTransitioning: false,
                    }));
                    throw new Error(`Validation failed for step ${fromStep}`);
                }
                setStepData(fromStep, data);
            }
            // Check if can exit current step
            const canExit = await canExitStep();
            if (!canExit) {
                updateState((state) => ({
                    ...state,
                    isTransitioning: false,
                }));
                throw new Error(`Cannot exit step ${fromStep}`);
            }
            // Execute beforeExit hook
            await executeBeforeExit();
            // Check if can enter target step
            const canEnter = await canEnterStep(targetStep);
            if (!canEnter) {
                updateState((state) => ({
                    ...state,
                    isTransitioning: false,
                }));
                throw new Error(`Cannot enter step ${targetStep}`);
            }
            // Save current state to history before transitioning
            if (transitionType !== 'back') {
                pushHistory();
            }
            // Update step
            updateState((state) => ({
                ...state,
                step: targetStep,
                isTransitioning: false,
            }));
            // Execute load hook for new step
            await executeLoad(targetStep);
            // Fire transition event
            if (onTransition) {
                const event = {
                    from: fromStep,
                    to: targetStep,
                    context: getContext(),
                    data: store.state.data,
                    type: transitionType,
                };
                await onTransition(event);
            }
        }
        catch (error) {
            updateState((state) => ({
                ...state,
                isTransitioning: false,
            }));
            throw error;
        }
    };
    // Go to next step
    const next = async (args) => {
        const nextSteps = getNextSteps();
        if (nextSteps.length === 0) {
            throw new Error('No next step available');
        }
        await transitionTo(nextSteps[0], args?.data, 'next');
    };
    // Go to specific step
    const goTo = async (step, args) => {
        await transitionTo(step, args?.data, 'goto');
    };
    // Go back to previous step
    const back = async () => {
        const state = store.state;
        if (!keepHistory || state.history.length === 0) {
            throw new Error('No history available to go back');
        }
        const previousState = state.history[state.history.length - 1];
        updateState((s) => ({
            ...s,
            step: previousState.step,
            context: previousState.context,
            data: previousState.data,
            history: s.history.slice(0, -1),
        }));
        // Execute load hook for restored step
        await executeLoad(previousState.step);
        // Fire transition event
        if (onTransition) {
            const event = {
                from: state.step,
                to: previousState.step,
                context: getContext(),
                data: store.state.data,
                type: 'back',
            };
            await onTransition(event);
        }
    };
    // Reset wizard
    const reset = () => {
        updateState(() => ({
            step: initialStep,
            context: cloneContext(initialContext),
            data: {},
            errors: {},
            history: [],
            isLoading: false,
            isTransitioning: false,
        }));
        if (persistence?.clear) {
            persistence.clear();
        }
    };
    // Subscribe to state changes
    const subscribe = (cb) => {
        return store.subscribe(() => {
            cb(store.state);
        });
    };
    // Get state snapshot
    const snapshot = () => {
        return structuredClone(store.state);
    };
    // Restore from snapshot
    const restore = (snap) => {
        updateState(() => snap);
    };
    // Destroy wizard
    const destroy = () => {
        eventListeners.clear();
    };
    return {
        store,
        next,
        goTo,
        back,
        reset,
        updateContext,
        setStepData,
        getContext,
        getCurrent,
        subscribe,
        emit,
        snapshot,
        restore,
        destroy,
    };
}
