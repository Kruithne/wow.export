type ProgressObject = {
	segWeight: number;
	value: number;
	step: (text?: string) => Promise<void>;
};

export default ProgressObject;