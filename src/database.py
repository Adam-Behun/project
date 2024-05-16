# handles interactions with the databse

import sqlite3
import pandas as pd

def execute_sql_query(sql_query):
    conn = sqlite3.connect('../data/tpch.db')
    cur = conn.cursor()
    cur.execute(sql_query)
    results = cur.fetchall()

    # gives me name of each column as well as metadata from cur.desription
    columns = [description[0] for description in cur.description]
    conn.close()

    # returns as a pandas dataframe
    return pd.DataFrame(results, columns=columns)