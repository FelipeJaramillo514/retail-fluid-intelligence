-- Clasificación de los estados de los pedidos (fuente SQL del ETL).
CREATE TABLE status_reference (status_code TEXT PRIMARY KEY, status_group TEXT NOT NULL);
INSERT INTO status_reference (status_code, status_group) VALUES
  ('Cancelled', 'Cancelado'),
  ('Disputed', 'En disputa'),
  ('In Process', 'Pendiente'),
  ('On Hold', 'Pendiente'),
  ('Pending', 'Pendiente'),
  ('Resolved', 'Cerrado'),
  ('Shipped', 'Cerrado');
