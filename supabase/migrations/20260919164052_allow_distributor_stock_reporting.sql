-- Permite que cada operador de distribuidora lea su asignación y mantenga
-- únicamente el stock de las distribuidoras que opera.
create policy distributor_users_self_select on distributor_users
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy distributor_product_stocks_operator on distributor_product_stocks
  for all
  to authenticated
  using (
    auth_role() = 'distributor_operator'
    and company_id = auth_company_id()
    and operates_for_distributor(distributor_id)
  )
  with check (
    auth_role() = 'distributor_operator'
    and company_id = auth_company_id()
    and operates_for_distributor(distributor_id)
  );

create index idx_distributor_users_user_id
  on distributor_users(user_id);
