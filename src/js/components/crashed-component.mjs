class CrashedComponent extends HTMLElement {
	constructor() {
		super();
	}

	connectedCallback() {
		const shadow = this.attachShadow({ mode: "open" });
		const el = document.createElement('div');
		el.innerText = 'component has crashed';
		el.style.border = "2px solid red";
		el.style.backgroundColor = 'indianred';
		el.style.display = "flex";
		el.style.alignItems = "center";
		el.style.justifyContent = "center";
		el.style.opacity = "0.7";
		el.style.padding = "10px";
		el.style.height = "100%";
		shadow.appendChild(el);
	}
}

customElements.define("crashed-component", CrashedComponent);