/**
 * Represents and holds data for a specific block of markup.
 *
 * @author Ian Paterson
 */

botoweb.ui.markup.Block = function (node, opt) {
	if (!opt) opt = {};

	var $markup = botoweb.ui.markup;
	var self = this;

	this.node = node;
	this.obj = opt.obj;
	this.model = opt.model;
	this.parent = opt.parent;
	this.onready = [];
	this.children = [];
	this.fields = [];
	this.nested = [];
	this.waiting = 0;
	this.opt = opt;
	this.state = 'view';

	if (opt.onready)
		this.onready.push(opt.onready);

	if (this.obj && !this.model)
		this.model = this.obj.model;

	this.skip_markup = opt.skip_markup || {};
	this.nested_sel = opt.nested_sel;

	try {
		this.node.hide();
	} catch (e) {}

	if (this.opt.root) {
		$(botoweb.ui.page)
			.bind('change', function (e, loc, new_page) {

			// Don't mess with other pages
			if (new_page)
				return;

			if (loc.data.id == self.obj.id) {
				self.opt = loc.data;

				if (!self.waiting)
					self.done();

				// Block other handlers
				e.stopImmediatePropagation();

				return false;
			}
		});
	}

	this.save = function () {
		for (var i in this.children) {
			var child = this.children[i];
			if (child.val === undefined) {
				child.save();
				return;
			}
		}

		for (var i in this.fields) {
			var val = this.fields[i].val();
			if (val === undefined) {
				child.save();
				return;
			}
		}
	}

	/**
	 * Passes parsing optimization data along to a new block created from node.
	 * The node should of course be the same as the node that was used to create
	 * this block, otherwise the optimization data is probably invalid.
	 *
	 * @param {DOMNode} node The node to build the Block on.
	 * @param {Object} opt Same options as Block constructor.
	 */
	this.clone = function (node, opt) {
		if (!opt) opt = {};

		opt.skip_markup = this.skip_markup;
		opt.nested_sel = this.nested_sel;

		return new $markup.Block(node, opt);
	};

	if (this.parent && !this.model)
		this.model = this.parent.model;

	if (node.attr($markup.prop.model)) {
		this.model = botoweb.env.models[node.attr($markup.prop.model)];
	}



	this.done = function () {
		$.each(this.onready, function () { this(self) });
		this.onready = [];

		if (this.obj && this.opt.action == 'edit' && this.state != 'edit') {
			this.state = 'edit';
			$(this.obj).triggerHandler('edit');
		}

		if (this.obj && !this.opt.action && this.state != 'view') {
			$(this.obj).triggerHandler('cancel_' + this.state);
			this.state = 'view';
		}
/*
		if (this.parent) {
			this.parent.waiting--;

			if (this.parent.waiting == 0)
				this.parent.done();
		}
*/
	}

	this.init = function () {
		/**
		 * If the parsing routine has not been marked to skip, runs the parsing
		 * function. If the parsing function returns
		 *
		 * @private
		 */
		function parse (str, fnc) {
			if (self.skip_markup[str])
				return;

			// If the parser returns false, skip it next time
			if (fnc(self) === false)
				self.skip_markup[str] = 1;
		}

		// Do not allow nested blocks to interfere
		parse('nested', $markup.remove_nested);

		// Parse stuff in the order specified
		$.each(['condition', 'trigger', 'attribute_list', 'attribute', 'editing_tools', 'link'], function () {
			if (!self.skip_markup[this])
				parse(this, $markup.parse[this]);
		});

		// Add nested blocks again
		$markup.restore_nested(this);

		// Parse stuff in the order specified
		$.each(['relation','search'], function () {
			if (!self.skip_markup[this])
				parse(this, $markup.parse[this]);
		});

		try {
			this.node.show();
		} catch (e) {}

		if (opt.oninit)
			opt.oninit.call(this);

		if (!this.waiting)
			this.done();
	};

	if (this.model && !this.obj && opt.id) {
		this.model.get(opt.id, function (obj) {
			self.obj = obj;

			self.init();
		});
	}
	else
		this.init();
};