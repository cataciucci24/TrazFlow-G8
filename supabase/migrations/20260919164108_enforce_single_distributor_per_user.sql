-- Una cuenta operadora representa a una sola distribuidora.
drop index if exists idx_distributor_users_user_id;

create unique index distributor_users_one_distributor_per_user_idx
  on distributor_users(user_id);
