import sqlite3

def create_database():
    # Connect to SQLite database
    conn = sqlite3.connect('../data/tpch.db') 
    cur = conn.cursor()

    # Create REGION Table
    cur.execute('''
    CREATE TABLE IF NOT EXISTS REGION (
        REGIONKEY INTEGER PRIMARY KEY,
        NAME TEXT,
        COMMENT TEXT
    );
    ''')

    # Create NATION Table
    cur.execute('''
    CREATE TABLE IF NOT EXISTS NATION (
        NATIONKEY INTEGER PRIMARY KEY,
        NAME TEXT,
        REGIONKEY INTEGER,
        COMMENT TEXT,
        FOREIGN KEY (REGIONKEY) REFERENCES REGION(REGIONKEY)
    );
    ''')

    # Create PART Table
    cur.execute('''
    CREATE TABLE IF NOT EXISTS PART (
        PARTKEY INTEGER PRIMARY KEY,
        NAME TEXT,
        MFGR TEXT,
        BRAND TEXT,
        TYPE TEXT,
        SIZE INTEGER,
        CONTAINER TEXT,
        RETAILPRICE REAL,
        COMMENT TEXT
    );
    ''')

    # Create SUPPLIER Table
    cur.execute('''
    CREATE TABLE IF NOT EXISTS SUPPLIER (
        SUPPKEY INTEGER PRIMARY KEY,
        NAME TEXT,
        ADDRESS TEXT,
        NATIONKEY INTEGER,
        PHONE TEXT,
        ACCTBAL REAL,
        COMMENT TEXT,
        FOREIGN KEY (NATIONKEY) REFERENCES NATION(NATIONKEY)
    );
    ''')

    # Create PARTSUPP Table
    cur.execute('''
    CREATE TABLE IF NOT EXISTS PARTSUPP (
        PARTKEY INTEGER,
        SUPPKEY INTEGER,
        AVAILQTY INTEGER,
        SUPPLYCOST REAL,
        COMMENT TEXT,
        PRIMARY KEY (PARTKEY, SUPPKEY),
        FOREIGN KEY (PARTKEY) REFERENCES PART(PARTKEY),
        FOREIGN KEY (SUPPKEY) REFERENCES SUPPLIER(SUPPKEY)
    );
    ''')

    # Create CUSTOMER Table
    cur.execute('''
    CREATE TABLE IF NOT EXISTS CUSTOMER (
        CUSTKEY INTEGER PRIMARY KEY,
        NAME TEXT,
        ADDRESS TEXT,
        NATIONKEY INTEGER,
        PHONE TEXT,
        ACCTBAL REAL,
        MKTSEGMENT TEXT,
        COMMENT TEXT,
        FOREIGN KEY (NATIONKEY) REFERENCES NATION(NATIONKEY)
    );
    ''')

    # Create ORDERS Table
    cur.execute('''
    CREATE TABLE IF NOT EXISTS ORDERS (
        ORDERKEY INTEGER PRIMARY KEY,
        CUSTKEY INTEGER,
        ORDERSTATUS TEXT,
        TOTALPRICE REAL,
        ORDERDATE TEXT,
        ORDERPRIORITY TEXT,
        CLERK TEXT,
        SHIPPRIORITY INTEGER,
        COMMENT TEXT,
        FOREIGN KEY (CUSTKEY) REFERENCES CUSTOMER(CUSTKEY)
    );
    ''')

    # Create LINEITEM Table
    cur.execute('''
    CREATE TABLE IF NOT EXISTS LINEITEM (
        ORDERKEY INTEGER,
        PARTKEY INTEGER,
        SUPPKEY INTEGER,
        LINENUMBER INTEGER,
        QUANTITY INTEGER,
        EXTENDEDPRICE REAL,
        DISCOUNT REAL,
        TAX REAL,
        RETURNFLAG TEXT,
        LINESTATUS TEXT,
        SHIPDATE TEXT,
        COMMITDATE TEXT,
        RECEIPTDATE TEXT,
        SHIPINSTRUCT TEXT,
        SHIPMODE TEXT,
        COMMENT TEXT,
        PRIMARY KEY (ORDERKEY, PARTKEY, SUPPKEY, LINENUMBER),
        FOREIGN KEY (ORDERKEY) REFERENCES ORDERS(ORDERKEY),
        FOREIGN KEY (PARTKEY) REFERENCES PART(PARTKEY),
        FOREIGN KEY (SUPPKEY) REFERENCES SUPPLIER(SUPPKEY)
    );
    ''')
    
    # Insert sample data
    cur.execute("INSERT INTO REGION (REGIONKEY, NAME, COMMENT) VALUES (0, 'AFRICA', 'No comment')")
    cur.execute("INSERT INTO REGION (REGIONKEY, NAME, COMMENT) VALUES (1, 'AMERICA', 'No comment')")
    cur.execute("INSERT INTO REGION (REGIONKEY, NAME, COMMENT) VALUES (2, 'ASIA', 'No comment')")
    cur.execute("INSERT INTO REGION (REGIONKEY, NAME, COMMENT) VALUES (3, 'EUROPE', 'No comment')")
    cur.execute("INSERT INTO REGION (REGIONKEY, NAME, COMMENT) VALUES (4, 'MIDDLE EAST', 'No comment')")

    cur.execute("INSERT INTO NATION (NATIONKEY, NAME, REGIONKEY, COMMENT) VALUES (0, 'ALGERIA', 0, 'No comment')")
    cur.execute("INSERT INTO NATION (NATIONKEY, NAME, REGIONKEY, COMMENT) VALUES (1, 'ARGENTINA', 1, 'No comment')")
    cur.execute("INSERT INTO NATION (NATIONKEY, NAME, REGIONKEY, COMMENT) VALUES (2, 'BRAZIL', 1, 'No comment')")
    cur.execute("INSERT INTO NATION (NATIONKEY, NAME, REGIONKEY, COMMENT) VALUES (3, 'CANADA', 1, 'No comment')")
    cur.execute("INSERT INTO NATION (NATIONKEY, NAME, REGIONKEY, COMMENT) VALUES (4, 'EGYPT', 0, 'No comment')")
    cur.execute("INSERT INTO NATION (NATIONKEY, NAME, REGIONKEY, COMMENT) VALUES (5, 'ETHIOPIA', 0, 'No comment')")
    cur.execute("INSERT INTO NATION (NATIONKEY, NAME, REGIONKEY, COMMENT) VALUES (6, 'FRANCE', 3, 'No comment')")
    cur.execute("INSERT INTO NATION (NATIONKEY, NAME, REGIONKEY, COMMENT) VALUES (7, 'GERMANY', 3, 'No comment')")
    cur.execute("INSERT INTO NATION (NATIONKEY, NAME, REGIONKEY, COMMENT) VALUES (8, 'INDIA', 2, 'No comment')")
    cur.execute("INSERT INTO NATION (NATIONKEY, NAME, REGIONKEY, COMMENT) VALUES (9, 'INDONESIA', 2, 'No comment')")

    cur.execute("INSERT INTO PART (PARTKEY, NAME, MFGR, BRAND, TYPE, SIZE, CONTAINER, RETAILPRICE, COMMENT) VALUES (1, 'Part1', 'Manufacturer1', 'Brand1', 'Type1', 10, 'Container1', 100.0, 'No comment')")
    cur.execute("INSERT INTO PART (PARTKEY, NAME, MFGR, BRAND, TYPE, SIZE, CONTAINER, RETAILPRICE, COMMENT) VALUES (2, 'Part2', 'Manufacturer2', 'Brand2', 'Type2', 20, 'Container2', 200.0, 'No comment')")
    cur.execute("INSERT INTO PART (PARTKEY, NAME, MFGR, BRAND, TYPE, SIZE, CONTAINER, RETAILPRICE, COMMENT) VALUES (3, 'Part3', 'Manufacturer3', 'Brand3', 'Type3', 30, 'Container3', 300.0, 'No comment')")
    cur.execute("INSERT INTO PART (PARTKEY, NAME, MFGR, BRAND, TYPE, SIZE, CONTAINER, RETAILPRICE, COMMENT) VALUES (4, 'Part4', 'Manufacturer4', 'Brand4', 'Type4', 40, 'Container4', 400.0, 'No comment')")
    cur.execute("INSERT INTO PART (PARTKEY, NAME, MFGR, BRAND, TYPE, SIZE, CONTAINER, RETAILPRICE, COMMENT) VALUES (5, 'Part5', 'Manufacturer5', 'Brand5', 'Type5', 50, 'Container5', 500.0, 'No comment')")

    cur.execute("INSERT INTO SUPPLIER (SUPPKEY, NAME, ADDRESS, NATIONKEY, PHONE, ACCTBAL, COMMENT) VALUES (1, 'Supplier1', 'Address1', 0, '123-456-7890', 1000.0, 'No comment')")
    cur.execute("INSERT INTO SUPPLIER (SUPPKEY, NAME, ADDRESS, NATIONKEY, PHONE, ACCTBAL, COMMENT) VALUES (2, 'Supplier2', 'Address2', 1, '234-567-8901', 2000.0, 'No comment')")
    cur.execute("INSERT INTO SUPPLIER (SUPPKEY, NAME, ADDRESS, NATIONKEY, PHONE, ACCTBAL, COMMENT) VALUES (3, 'Supplier3', 'Address3', 2, '345-678-9012', 3000.0, 'No comment')")
    cur.execute("INSERT INTO SUPPLIER (SUPPKEY, NAME, ADDRESS, NATIONKEY, PHONE, ACCTBAL, COMMENT) VALUES (4, 'Supplier4', 'Address4', 3, '456-789-0123', 4000.0, 'No comment')")
    cur.execute("INSERT INTO SUPPLIER (SUPPKEY, NAME, ADDRESS, NATIONKEY, PHONE, ACCTBAL, COMMENT) VALUES (5, 'Supplier5', 'Address5', 4, '567-890-1234', 5000.0, 'No comment')")

    cur.execute("INSERT INTO PARTSUPP (PARTKEY, SUPPKEY, AVAILQTY, SUPPLYCOST, COMMENT) VALUES (1, 1, 500, 50.0, 'No comment')")
    cur.execute("INSERT INTO PARTSUPP (PARTKEY, SUPPKEY, AVAILQTY, SUPPLYCOST, COMMENT) VALUES (2, 2, 1000, 100.0, 'No comment')")
    cur.execute("INSERT INTO PARTSUPP (PARTKEY, SUPPKEY, AVAILQTY, SUPPLYCOST, COMMENT) VALUES (3, 3, 1500, 150.0, 'No comment')")
    cur.execute("INSERT INTO PARTSUPP (PARTKEY, SUPPKEY, AVAILQTY, SUPPLYCOST, COMMENT) VALUES (4, 4, 2000, 200.0, 'No comment')")
    cur.execute("INSERT INTO PARTSUPP (PARTKEY, SUPPKEY, AVAILQTY, SUPPLYCOST, COMMENT) VALUES (5, 5, 2500, 250.0, 'No comment')")

    cur.execute("INSERT INTO CUSTOMER (CUSTKEY, NAME, ADDRESS, NATIONKEY, PHONE, ACCTBAL, MKTSEGMENT, COMMENT) VALUES (1, 'Customer1', 'Address1', 2, '345-678-9012', 500.0, 'Segment1', 'No comment')")
    cur.execute("INSERT INTO CUSTOMER (CUSTKEY, NAME, ADDRESS, NATIONKEY, PHONE, ACCTBAL, MKTSEGMENT, COMMENT) VALUES (2, 'Customer2', 'Address2', 3, '456-789-0123', 600.0, 'Segment2', 'No comment')")
    cur.execute("INSERT INTO CUSTOMER (CUSTKEY, NAME, ADDRESS, NATIONKEY, PHONE, ACCTBAL, MKTSEGMENT, COMMENT) VALUES (3, 'Customer3', 'Address3', 4, '567-890-1234', 700.0, 'Segment3', 'No comment')")
    cur.execute("INSERT INTO CUSTOMER (CUSTKEY, NAME, ADDRESS, NATIONKEY, PHONE, ACCTBAL, MKTSEGMENT, COMMENT) VALUES (4, 'Customer4', 'Address4', 5, '678-901-2345', 800.0, 'Segment4', 'No comment')")
    cur.execute("INSERT INTO CUSTOMER (CUSTKEY, NAME, ADDRESS, NATIONKEY, PHONE, ACCTBAL, MKTSEGMENT, COMMENT) VALUES (5, 'Customer5', 'Address5', 1, '789-012-3456', 900.0, 'Segment5', 'No comment')")

    cur.execute("INSERT INTO ORDERS (ORDERKEY, CUSTKEY, ORDERSTATUS, TOTALPRICE, ORDERDATE, ORDERPRIORITY, CLERK, SHIPPRIORITY, COMMENT) VALUES (1, 1, 'O', 150.0, '2023-01-01', '1-URGENT', 'Clerk#1', 0, 'No comment')")
    cur.execute("INSERT INTO ORDERS (ORDERKEY, CUSTKEY, ORDERSTATUS, TOTALPRICE, ORDERDATE, ORDERPRIORITY, CLERK, SHIPPRIORITY, COMMENT) VALUES (2, 2, 'F', 250.0, '2023-01-02', '2-HIGH', 'Clerk#2', 0, 'No comment')")
    cur.execute("INSERT INTO ORDERS (ORDERKEY, CUSTKEY, ORDERSTATUS, TOTALPRICE, ORDERDATE, ORDERPRIORITY, CLERK, SHIPPRIORITY, COMMENT) VALUES (3, 3, 'O', 350.0, '2023-01-03', '3-MEDIUM', 'Clerk#3', 0, 'No comment')")
    cur.execute("INSERT INTO ORDERS (ORDERKEY, CUSTKEY, ORDERSTATUS, TOTALPRICE, ORDERDATE, ORDERPRIORITY, CLERK, SHIPPRIORITY, COMMENT) VALUES (4, 4, 'O', 450.0, '2023-01-04', '4-LOW', 'Clerk#4', 0, 'No comment')")
    cur.execute("INSERT INTO ORDERS (ORDERKEY, CUSTKEY, ORDERSTATUS, TOTALPRICE, ORDERDATE, ORDERPRIORITY, CLERK, SHIPPRIORITY, COMMENT) VALUES (5, 5, 'F', 550.0, '2023-01-05', '5-LOWEST', 'Clerk#5', 0, 'No comment')")

    cur.execute("INSERT INTO LINEITEM (ORDERKEY, PARTKEY, SUPPKEY, LINENUMBER, QUANTITY, EXTENDEDPRICE, DISCOUNT, TAX, RETURNFLAG, LINESTATUS, SHIPDATE, COMMITDATE, RECEIPTDATE, SHIPINSTRUCT, SHIPMODE, COMMENT) VALUES (1, 1, 1, 1, 5, 500.0, 0.0, 0.0, 'N', 'O', '2023-01-10', '2023-01-05', '2023-01-15', 'DELIVER IN PERSON', 'AIR', 'No comment')")
    cur.execute("INSERT INTO LINEITEM (ORDERKEY, PARTKEY, SUPPKEY, LINENUMBER, QUANTITY, EXTENDEDPRICE, DISCOUNT, TAX, RETURNFLAG, LINESTATUS, SHIPDATE, COMMITDATE, RECEIPTDATE, SHIPINSTRUCT, SHIPMODE, COMMENT) VALUES (2, 2, 2, 2, 10, 1000.0, 0.1, 0.1, 'R', 'F', '2023-01-20', '2023-01-15', '2023-01-25', 'TAKE BACK RETURN', 'RAIL', 'No comment')")
    cur.execute("INSERT INTO LINEITEM (ORDERKEY, PARTKEY, SUPPKEY, LINENUMBER, QUANTITY, EXTENDEDPRICE, DISCOUNT, TAX, RETURNFLAG, LINESTATUS, SHIPDATE, COMMITDATE, RECEIPTDATE, SHIPINSTRUCT, SHIPMODE, COMMENT) VALUES (3, 3, 3, 3, 15, 1500.0, 0.2, 0.2, 'N', 'O', '2023-01-30', '2023-01-25', '2023-02-05', 'COLLECT CUSTOMER', 'SHIP', 'No comment')")
    cur.execute("INSERT INTO LINEITEM (ORDERKEY, PARTKEY, SUPPKEY, LINENUMBER, QUANTITY, EXTENDEDPRICE, DISCOUNT, TAX, RETURNFLAG, LINESTATUS, SHIPDATE, COMMITDATE, RECEIPTDATE, SHIPINSTRUCT, SHIPMODE, COMMENT) VALUES (4, 4, 4, 4, 20, 2000.0, 0.3, 0.3, 'R', 'F', '2023-02-10', '2023-02-05', '2023-02-15', 'TAKE BACK RETURN', 'RAIL', 'No comment')")
    cur.execute("INSERT INTO LINEITEM (ORDERKEY, PARTKEY, SUPPKEY, LINENUMBER, QUANTITY, EXTENDEDPRICE, DISCOUNT, TAX, RETURNFLAG, LINESTATUS, SHIPDATE, COMMITDATE, RECEIPTDATE, SHIPINSTRUCT, SHIPMODE, COMMENT) VALUES (5, 5, 5, 5, 25, 2500.0, 0.4, 0.4, 'N', 'O', '2023-02-20', '2023-02-15', '2023-02-25', 'COLLECT CUSTOMER', 'SHIP', 'No comment')")

    conn.commit()
    conn.close()

if __name__ == '__main__':
    create_database()