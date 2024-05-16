import streamlit as st
from model import translate_to_sql
from database import execute_sql_query

def main():
    st.set_page_config(page_title='SQL Query Generator', page_icon=':robot:')

    st.markdown(
        """
        <style>
            .header{
                padding: 20px;
                background-color:#f0f0f0;
                border-radius: 10px;
                margin-bottom: 20px;
                color: black;
            }
            .header h1, .header h3{
                margin: 0;
                color: black;
            }
        <style>
        """, unsafe_allow_html=True)
    st.markdown(
        """
        <div class="header">
            <h1 style="text-align: center;">SQL Query Generator 🤖</h1>
            <h3 style="text-align: center;">Talk to your SQL database</h3>
        </div>
        """, unsafe_allow_html=True)        
    
    input_text = st.text_area('What would you like to learn from your database?')

    submit = st.button('Generate SQL Query', key='generate_button')

    if submit:
        with st.spinner('Generating SQL query'):
            sql_query = translate_to_sql(input_text)
            st.header('Model response')
            st.success('Generated successfully')
            st.write(sql_query)

            try:
                df = execute_sql_query(sql_query)
                st.success('Output')
                st.dataframe(df)

                st.success('Explanation of the query')
                st.write(f"Query retries the following data: {input_text}")
            except Exception as e:
                st.error(f"Error executing query: {e}")

if __name__ == '__main__':
    main()

