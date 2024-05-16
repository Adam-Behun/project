# handles interactions with the databse

import sqlite3
import pandas as pd

def execute_sql_query(sql_query):
    conn = sqlite3.connect('../data/tpch.db')
    cur = conn.cursor()
    try:
        cur.execute(sql_query)
        results = cur.fetchall()
        columns = [description[0] for description in cur.description]
        df = pd.DataFrame(results, columns=columns)
    except Exception as e:
        print(f"Error executing query: {e}")
        df = pd.DataFrame()  # Return an empty DataFrame in case of error
    finally:
        conn.close()
    return df
