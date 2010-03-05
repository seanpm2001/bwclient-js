/**
 * A library of botoweb markup parsers
 *
 * @author Ian Paterson
 */

(function () {
	var self = botoweb.ui.markup;

	botoweb.ui.markup.parse = {
		/**
		 * Parse conditional tags and remove them from the block.node if the
		 * corresponding condition function returns false.
		 */
		condition: function (block) {
			var matches = false;

			self.find(block.node, 'condition', function (val, prop) {
				matches = true;

				if (val in botoweb.env.cfg.conditions){
					if(botoweb.env.cfg.conditions[val](block.obj, this) === false)
						this.remove();
				}
				else {
					botoweb.util.error('UI condition does not exist: ' + val);
					this.removeAttr(prop);
				}
			});

			return matches;
		},

		/**
		 * Parse triggers and execute them.
		 */
		trigger: function (block) {
			var matches = false;

			self.find(block.node, 'trigger', function (val, prop) {
				matches = true;

				if (val in botoweb.env.cfg.triggers)
					botoweb.env.cfg.triggers[val](block.obj, this);
				else
					this.removeAttr(prop);
			});

			return matches;
		},

		/**
		 * Parse attributes.
		 */
		attribute: function (block) {
			var matches = false;

			if (!block.model && !block.obj)
				return;

			var still_matches;
			var waiting = 0;

			do {
				still_matches = false;

				self.find(block.node, 'attribute', function(val, prop) {
					still_matches = matches = true;

					this.removeAttr(prop);

					// If the property is not supported, empty the container to
					// prevent anything inside from being parsed according to
					// the current object when it was intended for a referenced
					// object
					if (!(val in block.model.prop_map)) {
						this.empty();
						return;
					}

					if (block.model.prop_map[val].is_type('reference', 'query')) {
						var parent = this;
						var contents = this.contents().clone();
						this.empty();

						function descend (obj) {
							var b = new botoweb.ui.markup.Block($('<div/>').append(contents.clone()), { obj: obj });

							parent.append(b.node.contents());
						}

						if (block.obj) {
							waiting++;

							block.obj.follow(val, function (objs) {
								$.each(objs, function () {
									descend(this);
								});

								waiting--;

								if (!waiting) {
									block.node.ready = true;
									block.node.trigger('ready');
									botoweb.util.log('FIRE');
								}
							});
						}
						else {
							descend();
						}
					}
					else if (block.model.prop_map[val].is_type('dateTime')) {
						new botoweb.ui.widget.DateTime(this, block.obj.data[val].toString());
					}

					else if (block.obj && val in block.obj.data) {
						this.html(block.obj.data[val].toString());

						if (block.obj.model.name == 'User')
							botoweb.util.log(block.obj.data[val].toString());
					}
				}, {
					suffix: ':first'
				});
			}
			while (still_matches);

			if (!waiting) {
				block.node.ready = true;
				block.node.trigger('ready');
			}

			return matches;
		},

		/**
		 * Parse links.
		 */
		link: function (block) {
			var matches = false;

			if (!block.model && !block.obj)
				return;

			self.find(block.node, 'link', function(val, prop) {
				matches = true;

				this.removeAttr(prop);
				this.attr('href', '#');
			});

			return matches;
		},

		/**
		 * Parse attribute lists.
		 */
		attribute_list: function (block) {
			var matches = false;

			if (!block.model && !block.obj)
				return;

			self.find(block.node, 'attribute_list', function() {
				matches = true;

				new botoweb.ui.widget.AttributeList(this);
			});

			return matches;
		},

		/**
		 * Parse relation blocks.
		 */
		relation: function (block) {
			var matches = false;

			if (!block.model && !block.obj)
				return;

			self.find(block.node, 'relation', function() {
				matches = true;
			});

			return matches;
		},

		/**
		 * Parse date times.
		 */
		date_time: function (block) {
			var matches = false;

			self.find(block.node, 'date_time', function() {
				matches = true;

				new botoweb.ui.widget.DateTime(this);
			});

			return matches;
		},

		/**
		 * Add editing tools for models and objects.
		 */
		editing_tools: function (block) {
			var matches = false;

			if (!block.model && !block.obj)
				return;

			self.find(block.node, 'editing_tools', function() {
				matches = true;
				new botoweb.ui.widget.EditingTools(this, block.model, (this.attr(self.prop.attributes) || ''));
			});

			return matches;
		},

		/**
		 * Parse search blocks.
		 */
		search: function (block) {
			var matches = false;

			self.find(block.node, 'search', function() {
				matches = true;

				new botoweb.ui.widget.Search(this);
			});

			return matches;
		},

		/**
		 * Parse search result blocks.
		 */
		search_results: function (block) {
			var matches = false;

			self.find(block.node, 'search_results', function() {
				matches = true;
				new botoweb.ui.widget.SearchResults(this, block.model);
			});

			return matches;
		}
	};
})();