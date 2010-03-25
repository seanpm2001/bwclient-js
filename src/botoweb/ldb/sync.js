/**
 * Manages synchronization between the local and remote databases.
 *
 * @author Ian Paterson
 */
botoweb.ldb.sync = {
	/**
	 * The total number of records which have been updated so far.
	 */
	task_processed: 0,
	/**
	 * The total number of records which are set to update.
	 */
	task_total: 0,
	running: false,
	update_queue: [],
	refresh_queue: [],
	first_sync: true,

	/**
	 * Updates the local database by querying a model for recently updated
	 * records. When called with no arguments, updates all models in the
	 * environment config db.sync_models array. Records are updated if they
	 * exist or inserted if they do not. Unless the all parameter is true,
	 * updates anything which has changed since the last_update localStorage key
	 * and also updates that key.
	 *
	 * @param {[botoweb.Model]} models The model to query.
	 * @param {Boolean} refresh If true, fetches all records regardless of
	 * update timestamps.
	 */
	update: function(models, opt) {
		if (!botoweb.ldb.dbh)
			return $(this).trigger('end');

		opt = opt || {};
		var self = botoweb.ldb.sync;

		if (!models)
			models = botoweb.env.cfg.db.sync_models;

		if (!$.isArray(models))
			models = [models];

		$.each(models, function() {
			if (opt.refresh)
				self.refresh_queue.push(this);
			else
				self.update_queue.push(this);
		});

		if (self.running)
			return;

		self.next_update();
	},

	/**
	 * Inspects the update and refresh queues to choose the next update to run.
	 * The refresh queue contains jobs which explicitly ask for all results, so
	 * these generally take longer and will be run when the update queue is
	 * empty.
	 */
	next_update: function() {
		var self = botoweb.ldb.sync;
		var model;
		var refresh = false;

		// Choose from the update queue first (these are generally faster jobs)
		if (this.update_queue.length)
			model = this.update_queue.shift();
		else if (this.refresh_queue.length) {
			model = this.refresh_queue.shift();
			refresh = true;
		}

		else if (self.first_sync) {
			botoweb.ldb.dbh.transaction(function (txn) {
				var c = 0;

				$.each(botoweb.env.models, function (i, model) {
					txn.executeSql('SELECT 1 FROM ' + botoweb.ldb.model_to_table(model) + ' LIMIT 1', [], function (txn, results) {
						if (results.rows.length)
							model.local = true;

						if (c == botoweb.env.model_names.length - 1) {
							self.first_sync = false;
							self.running = false;

							$(self).trigger('end');
						}

						c++;
					}, botoweb.util.error)
				});
			});

			return;
		}

		// All updates complete
		else {
			// The UI code can establish a listener for the end event
			self.running = false;

			$(self).trigger('end');

			return;
		}

		var model_name = model;

		if (!self.running)
			self.running = true;

		if (!model.name)
			model = botoweb.env.models[model];

		if (!model || !model.name) {
			botoweb.util.error('Cannot sync unknown model: ' + model_name, 'warning');
			return;
		}

		// Clear the table for a full refresh to ensure that deleted items are
		// deleted locally as well.
		if (refresh) {
			botoweb.ldb.dbh.transaction(function (txn) {
				botoweb.ldb.tables[model.name].__empty(txn);
			}, function () { });
		}

		self.task_processed = 0;
		self.task_total = 0;
		self.update_model = model;

		var timestamp = botoweb.util.timestamp();

		if (!refresh && localStorage['last_update_' + model.name])
			model.query([['sys_modstamp', '>', localStorage['last_update_' + model.name]]], self.process, { no_ldb: true, no_cache: true });
		else
			model.all(self.process, { no_ldb: true, no_cache: true });

		// Although we may fetch multiple pages of results, these results are a
		// snapshot of the current state, so the update time is now, not when
		// the query ends.
		localStorage.setItem('last_update_' + model.name, timestamp);
	},

	/**
	 * Drops all tables in the database, creates a fresh schema, then does a
	 * full CoreModel update. Use with caution, this will take a long time to
	 * run!
	 */
	reset: function() {
		var db = botoweb.ldb.dbh;
		$.each(botoweb.ldb.tables, function(i, table) {
			db.transaction(function (txn) {
				table.__drop(txn);
			});
		});

		self.first_sync = false;

		for (var key in localStorage) {
			if (key.indexOf('last_update') == 0)
				localStorage.setItem(key, '');
		}

		botoweb.ldb.prepare(function() {
			botoweb.ldb.sync.update();
		}, botoweb.util.error);
	},

	/**
	 * Processes sync results by updating or inserting corresponding records in
	 * the local database. List and complexType properties are handled by
	 * deleting all records corresponding to the object in the list or mapping
	 * table and then inserting anything in the object properties, to ensure
	 * that old data is not retained.
	 *
	 * This method triggers several events on botoweb.ldb.sync and the UI may
	 * bind listening functions to those events. The events are "begin" when
	 * the first page of results loads, "change" when each page of results is
	 * finished (useful for a progress bar), and "end" when all results have
	 * been loaded.
	 *
	 * @param {[botoweb.Object]} results The objects to be inserted.
	 * @param {Integer} page The current results page.
	 * @param {Integer} total_count The total results count.
	 */
	process: function (results, page, total_count) {
		var self = botoweb.ldb.sync;

		if (page == 0) {
			self.task_total += 1 * total_count;

			// The UI code can establish a listener for the begin event
			if (self.task_total) {
				$(self).trigger('begin', [{
					num_updates: self.task_total,
					model: self.update_model
				}]);
			}
		}

		var result_id = self.task_processed;

		botoweb.ldb.dbh.transaction(function (txn) {
			$.each(results, function(i, obj) {
				var db = botoweb.ldb.dbh;
				var bind_params = [obj.id];
				var model = obj.model;
				var column_names = [];

				// Update any cached versions of this object
				if (obj.id in model.objs)
					model.objs[obj.id] = obj;

				result_id++;

				// Find all the bound parameters in the order specified in the table
				$.each(model.props, function() {
					var model_prop = this;
					var prop = obj.data[this.meta.name];

					if (this.is_type('query', 'blob'))
						return;
					else if (this.is_type('list', 'complexType')) {
						// Ignore lookups to accelerate the first sync
						if (!self.first_sync) {
							txn.executeSql(
								'DELETE FROM ' + botoweb.ldb.prop_to_table(model_prop) +
								' WHERE id = ?',
								[obj.id],
								null,
								botoweb.util.error
							);
						}

						if (!prop)
							return;

						var v = prop.val();

						bind_params.push(v.length);

						$.each(v, function() {
							var bp = [obj.id, this.val];
							var values = '(?,?)';

							if (model_prop.is_type('complexType')) {
								bp = [obj.id, this.key, this.val];
								values = '(?,?,?)';
							}
							else if (model_prop.is_type('reference')) {
								bp = [obj.id, this.id, this.type];
								values = '(?,?,?)';
							}

							txn.executeSql(
								'INSERT INTO ' + botoweb.ldb.prop_to_table(model_prop) +
								' VALUES ' + values,
								bp,
								null,
								botoweb.util.error
							);
						});
					}
					else if (this.is_type('reference')) {
						column_names.push(botoweb.ldb.prop_to_column(this));
						column_names.push(botoweb.ldb.prop_to_column(this) + '__type');

						if (prop) {
							var v = prop.val()[0];
							bind_params.push(v.id);
							bind_params.push(v.type);
						}
						else {
							bind_params.push(null);
							bind_params.push(null);
						}
					}
					else {
						column_names.push(botoweb.ldb.prop_to_column(this));

						if (prop)
							bind_params.push(prop.to_sql());
						else
							bind_params.push(null);
					}
				});

				var rid = result_id + 0;

				txn.executeSql( ((self.first_sync) ? 'INSERT' : 'REPLACE') +
					' INTO ' + botoweb.ldb.model_to_table(model) +
					' VALUES (' + $.map(bind_params, function() { return '?' }).join(', ') + ')',
					bind_params,
					function () {
						if (rid % 50 == 0) {
							// The UI code can establish a listener for the change event
							$(self).trigger('change', [{
								percent_updated: (self.task_total) ? Math.round(10000 * rid / self.task_total) / 100 : 100,
								percent_downloaded: (self.task_total) ? Math.round(10000 * self.task_processed / self.task_total) / 100 : 100
							}]);
						}
					},
					botoweb.util.error
				);
			});
		});

		self.task_processed += results.length;

		// When we finish, run the next queued update
		if (self.task_processed >= self.task_total) {
			self.next_update();

			return false;
		}

		// Signals botoweb to fetch more pages
		return true;
	}
};